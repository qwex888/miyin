import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enqueueDownload,
  listTasks,
  getTaskStats,
  batchRetryTasks,
  batchCancelTasks,
  batchDeleteTasks,
} from '../server/services/downloadQueue'
import { resolveDeleteRequest } from '../server/utils/deleteFilter'
import { closeDb, getDb } from '../server/utils/db'

describe('Queue tab-level pagination and batch operations', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-tab-test-'))
    process.env.DATA_DIR = tmpDir
    process.env.DOWNLOAD_DIR = tmpDir
    closeDb()
  })

  afterEach(() => {
    closeDb()
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('filters tasks by tab properly with pagination', async () => {
    const db = getDb()
    // 插入不同状态的任务
    const now = new Date().toISOString()
    // 3 running, 2 queued
    for (let i = 1; i <= 3; i++) {
      db.prepare(`INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`r-${i}`, `Running ${i}`, 'Artist', 'wy', 'running', now, now)
    }
    for (let i = 1; i <= 2; i++) {
      db.prepare(`INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`q-${i}`, `Queued ${i}`, 'Artist', 'wy', 'queued', now, now)
    }
    // 4 completed
    for (let i = 1; i <= 4; i++) {
      db.prepare(`INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`c-${i}`, `Completed ${i}`, 'Artist', 'wy', 'completed', now, now)
    }
    // 2 failed, 1 cancelled
    for (let i = 1; i <= 2; i++) {
      db.prepare(`INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`f-${i}`, `Failed ${i}`, 'Artist', 'wy', 'failed', now, now)
    }
    db.prepare(`INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('can-1', 'Cancelled 1', 'Artist', 'wy', 'cancelled', now, now)

    // 测试 running tab
    const runningTab = listTasks({ tab: 'running', page: 1, pageSize: 10 })
    expect(runningTab.length).toBe(5)
    expect(runningTab.map(t => t.status)).toEqual(['running', 'running', 'running', 'queued', 'queued'])

    // 测试 completed tab
    const completedTab = listTasks({ tab: 'completed', page: 1, pageSize: 2 })
    expect(completedTab.length).toBe(2)
    expect(completedTab.every(t => t.status === 'completed')).toBe(true)

    // 测试 failed tab
    const failedTab = listTasks({ tab: 'failed', page: 1, pageSize: 10 })
    expect(failedTab.length).toBe(3)
    expect(failedTab.map(t => t.status).sort()).toEqual(['cancelled', 'failed', 'failed'])

    // 测试批量全量操作
    const retryRes = batchRetryTasks(undefined, { tab: 'failed' })
    expect(retryRes.count).toBe(3)
    const afterRetryFailed = listTasks({ tab: 'failed' })
    expect(afterRetryFailed.length).toBe(0)

    const cancelRes = batchCancelTasks(undefined, { tab: 'running' })
    expect(cancelRes.count).toBe(8) // 5 + 3 重试入队的

    const deleteCompleted = await batchDeleteTasks(undefined, { tab: 'completed' })
    expect(deleteCompleted.deleted).toBe(4)
    expect(listTasks({ tab: 'completed' }).length).toBe(0)
  })

  it('applies the active filters to tab-wide batch delete', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, quality, status, batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (let i = 1; i <= 3; i++) {
      insert.run(`low-${i}`, `Low ${i}`, 'Artist', 'wy', '128k', 'completed', 'b1', now, now)
    }
    for (let i = 1; i <= 5; i++) {
      insert.run(`high-${i}`, `High ${i}`, 'Artist', 'wy', 'flac', 'completed', 'b1', now, now)
    }

    // 「全选」勾选框上的数量来自带筛选的 stats，服务端求出的 id 必须与之同源
    expect(getTaskStats({ quality: '128k' }).completed).toBe(3)

    const res = await batchDeleteTasks(undefined, { tab: 'completed', filter: { quality: '128k' } })
    expect(res.deleted).toBe(3)
    expect(res.errors).toEqual([])

    const remaining = listTasks({ tab: 'completed', page: 1, pageSize: 10 })
    expect(remaining.length).toBe(5)
    expect(remaining.every((t) => t.quality === 'flac')).toBe(true)

    // 条件可叠加：批量 + 音质仍只删命中项
    const batchRes = await batchDeleteTasks(undefined, { tab: 'completed', filter: { batchId: 'b1', quality: 'flac' } })
    expect(batchRes.deleted).toBe(5)
    expect(listTasks({ tab: 'completed' }).length).toBe(0)
  })

  it('deletes every row of the tab when no filter is active', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, quality, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('a', 'A', 'Artist', 'wy', '128k', 'completed', now, now)
    insert.run('b', 'B', 'Artist', 'wy', 'flac', 'completed', now, now)
    insert.run('c', 'C', 'Artist', 'wy', '320k', 'failed', now, now)

    // 未筛选时保持既有语义：按分类整量删除
    expect((await batchDeleteTasks(undefined, { tab: 'completed', filter: {} })).deleted).toBe(2)
    expect(listTasks({ tab: 'completed' }).length).toBe(0)
    expect((await batchDeleteTasks(undefined, { tab: 'failed', filter: {} })).deleted).toBe(1)
    expect(listTasks({ tab: 'failed' }).length).toBe(0)
  })

  it('reports rows that could not be deleted instead of dropping them silently', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, quality, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('done', 'Done', 'Artist', 'wy', '128k', 'completed', now, now)
    insert.run('active', 'Active', 'Artist', 'wy', '128k', 'running', now, now)

    const res = await batchDeleteTasks(['done', 'active', 'missing'], { deleteLocalFiles: false })

    expect(res.deleted).toBe(1)
    expect(res.errors).toEqual([
      { id: 'active', error: '进行中的任务请先取消' },
      { id: 'missing', error: '任务不存在' },
    ])
    // 失败的行必须留在库里，前端才能在下一次加载时看到
    expect(listTasks({ tab: 'running' }).map((t) => t.id)).toEqual(['active'])
    expect(listTasks({ tab: 'completed' })).toHaveLength(0)
  })

  it('deletes rows across chunk boundaries', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, quality, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // 450 条跨过 200 条的分块边界
    for (let i = 0; i < 450; i++) {
      insert.run(`bulk-${i}`, `Bulk ${i}`, 'Artist', 'wy', '128k', 'completed', now, now)
    }

    const res = await batchDeleteTasks(undefined, { tab: 'completed' })

    expect(res.deleted).toBe(450)
    expect(res.errors).toEqual([])
    expect(listTasks({ tab: 'completed' })).toHaveLength(0)
  })

  it('rejects malformed delete filters before touching any row', () => {
    const db = getDb()
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, quality, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('keep-1', 'Keep 1', 'Artist', 'wy', '128k', 'completed', now, now)
    insert.run('keep-2', 'Keep 2', 'Artist', 'wy', 'flac', 'completed', now, now)

    const reject = (filters: unknown) => {
      try {
        resolveDeleteRequest({ allWithTab: 'completed', filters })
        return undefined
      } catch (e: any) {
        return e?.statusCode
      }
    }

    expect(reject({ quality: 320 })).toBe(400)
    expect(reject({ quality: '  ' })).toBe(400)
    expect(reject({ quality_filter: '128k' })).toBe(400)
    expect(reject([])).toBe(400)
    expect(reject('128k')).toBe(400)

    // 校验发生在删除之前：库里的两条一条都不能少
    expect(listTasks({ tab: 'completed' })).toHaveLength(2)
  })
})
