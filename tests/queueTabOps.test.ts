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

  it('filters tasks by tab properly with pagination', () => {
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

    const deleteCompleted = batchDeleteTasks(undefined, { tab: 'completed' })
    expect(deleteCompleted.deleted).toBe(4)
    expect(listTasks({ tab: 'completed' }).length).toBe(0)
  })
})
