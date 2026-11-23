import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { batchRetryTasks, getTaskStats } from '../server/services/downloadQueue'
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginThrottle,
} from '../server/utils/loginThrottle'
import { describeDownloadDirFailure } from '../server/utils/downloadDir'
import { createSseWriter } from '../server/utils/sseWriter'

declare global {
  var createError: (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => Error
}

globalThis.createError = (input) => {
  const err = new Error(input.statusMessage || 'Error') as Error & { statusCode?: number }
  err.statusCode = input.statusCode
  return err
}

describe('任务状态计数表（触发器维护）', () => {
  let dir: string

  beforeEach(() => {
    closeDb()
    dir = mkdtempSync(join(tmpdir(), 'miyin-stats-inc-'))
    process.env.DATA_DIR = dir
    process.env.DOWNLOAD_DIR = dir
    process.env.MIYIN_DISABLE_WORKER = '1'
  })

  afterEach(() => {
    closeDb()
    delete process.env.MIYIN_DISABLE_WORKER
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  function seed(id: string, status: string) {
    const now = new Date().toISOString()
    getDb()
      .prepare(
        `INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at)
         VALUES (?, ?, 'Artist', 'wy', ?, ?, ?)`,
      )
      .run(id, id, status, now, now)
  }

  it('入队、迁移、删除都同步维护计数', () => {
    seed('a', 'queued')
    seed('b', 'queued')
    seed('c', 'completed')

    let stats = getTaskStats()
    expect(stats.total).toBe(3)
    expect(stats.queued).toBe(2)
    expect(stats.completed).toBe(1)

    // 状态迁移（任意 UPDATE 路径都算，不依赖 queue 的封装）
    getDb().prepare(`UPDATE download_tasks SET status='failed' WHERE id='a'`).run()
    stats = getTaskStats()
    expect(stats.failed).toBe(1)
    expect(stats.queued).toBe(1)
    expect(stats.total).toBe(3)

    // 同值更新不应重复计数
    getDb().prepare(`UPDATE download_tasks SET status='failed' WHERE id='a'`).run()
    expect(getTaskStats().failed).toBe(1)

    // 删除回落
    getDb().prepare(`DELETE FROM download_tasks WHERE id='c'`).run()
    stats = getTaskStats()
    expect(stats.total).toBe(2)
    expect(stats.completed).toBe(0)
  })

  it('老库（无计数表）首次打开时按现有数据回填', () => {
    seed('old-1', 'completed')
    seed('old-2', 'failed')
    const db = getDb()
    // 模拟升级前形态：表与触发器都不存在
    db.exec(`
      DROP TRIGGER IF EXISTS trg_task_stats_insert;
      DROP TRIGGER IF EXISTS trg_task_stats_delete;
      DROP TRIGGER IF EXISTS trg_task_stats_status;
      DROP TABLE IF EXISTS task_stats;
    `)
    closeDb()

    const stats = getTaskStats()
    expect(stats.total).toBe(2)
    expect(stats.completed).toBe(1)
    expect(stats.failed).toBe(1)
    // 回填后触发器仍然生效
    getDb().prepare(`UPDATE download_tasks SET status='running' WHERE id='old-2'`).run()
    expect(getTaskStats().running).toBe(1)
  })

  it('带筛选时仍按主表聚合（计数表只覆盖无筛选）', () => {
    seed('q-1', 'queued')
    seed('q-2', 'completed')
    expect(getTaskStats({ platform: 'wy' }).total).toBe(2)
    expect(getTaskStats({ platform: 'tx' }).total).toBe(0)
  })
})

describe('批量操作分块让出事件循环', () => {
  let dir: string

  beforeEach(() => {
    closeDb()
    dir = mkdtempSync(join(tmpdir(), 'miyin-batch-chunk-'))
    process.env.DATA_DIR = dir
    process.env.DOWNLOAD_DIR = dir
    process.env.MIYIN_DISABLE_WORKER = '1'
    const now = new Date().toISOString()
    const db = getDb()
    const insert = db.prepare(
      `INSERT INTO download_tasks (id, title, artist, platform, status, created_at, updated_at)
       VALUES (?, ?, 'Artist', 'wy', 'failed', ?, ?)`,
    )
    db.transaction(() => {
      for (let i = 0; i < 450; i++) insert.run(`t-${i}`, `Track ${i}`, now, now)
    })()
  })

  afterEach(() => {
    closeDb()
    delete process.env.MIYIN_DISABLE_WORKER
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('450 条跨 3 块全部处理，且中途事件循环有轮转', async () => {
    let ticks = 0
    let handle: NodeJS.Immediate
    const bump = () => {
      ticks++
      handle = setImmediate(bump)
    }
    handle = setImmediate(bump)

    const res = await batchRetryTasks(undefined, { tab: 'failed' })
    clearImmediate(handle)

    expect(res.count).toBe(450)
    // 任务行有 title，错误项只有 { id, error }
    expect(res.items.filter((i) => !('title' in i))).toHaveLength(0)
    // 分批之间必须让出事件循环（否则万级批量会把 SSE 心跳按死）
    expect(ticks).toBeGreaterThan(0)
    const rows = getDb().prepare(`SELECT count(*) AS n FROM download_tasks WHERE status='queued'`).get() as {
      n: number
    }
    expect(rows.n).toBe(450)
  })
})

describe('登录失败限流', () => {
  beforeEach(() => {
    resetLoginThrottle()
  })

  it('前 3 次失败不阻塞，之后按 1s→2s 退避', () => {
    const ip = '10.0.0.1'
    const t0 = 1_000_000

    for (let i = 0; i < 3; i++) recordLoginFailure(ip, t0)
    expect(checkLoginAllowed(ip, t0)).toEqual({ allowed: true })

    recordLoginFailure(ip, t0) // 第 4 次
    const gate = checkLoginAllowed(ip, t0)
    expect(gate).toEqual({ allowed: false, retryAfterSec: 1, locked: false })
    // 到期后放行
    expect(checkLoginAllowed(ip, t0 + 1000)).toEqual({ allowed: true })

    recordLoginFailure(ip, t0 + 1000) // 第 5 次
    expect(checkLoginAllowed(ip, t0 + 1000)).toEqual({ allowed: false, retryAfterSec: 2, locked: false })
  })

  it('连续 10 次失败锁定 5 分钟', () => {
    const ip = '10.0.0.2'
    const t0 = 5_000_000
    for (let i = 0; i < 10; i++) recordLoginFailure(ip, t0)

    const gate = checkLoginAllowed(ip, t0)
    expect(gate.allowed).toBe(false)
    if (!gate.allowed) {
      expect(gate.locked).toBe(true)
      expect(gate.retryAfterSec).toBe(300)
    }
    // 锁定期间即使等待也仍然被拒
    expect(checkLoginAllowed(ip, t0 + 60_000).allowed).toBe(false)
    // 到期放行
    expect(checkLoginAllowed(ip, t0 + 300_000).allowed).toBe(true)
  })

  it('成功后清零，且按地址隔离', () => {
    const a = '10.0.0.3'
    const b = '10.0.0.4'
    const t0 = 9_000_000
    for (let i = 0; i < 5; i++) recordLoginFailure(a, t0)
    expect(checkLoginAllowed(a, t0).allowed).toBe(false)
    // 另一个地址不受影响
    expect(checkLoginAllowed(b, t0).allowed).toBe(true)

    recordLoginSuccess(a)
    expect(checkLoginAllowed(a, t0).allowed).toBe(true)
  })
})

describe('下载目录错误码细分', () => {
  const dir = '/volume1/downloads'

  it.each([
    ['ENOSPC', /磁盘空间不足/],
    ['EROFS', /只读挂载/],
    ['ENOENT', /路径不存在/],
    ['ENOTDIR', /同名文件占位/],
    ['EDQUOT', /配额/],
    ['EACCES', /无下载目录写入权限/],
  ])('%s 给出可执行建议', (code, pattern) => {
    expect(describeDownloadDirFailure(code, dir)).toMatch(pattern)
  })

  it('未知 errno 退回原始错误信息而不是笼统的权限文案', () => {
    expect(describeDownloadDirFailure('EIO', dir, '下载目录不可写: EIO 细节')).toBe(
      '下载目录不可写: EIO 细节',
    )
  })
})

describe('SSE 背压', () => {
  function fakeSink(initialBuffer = 0) {
    const chunks: string[] = []
    const sink = {
      writableLength: initialBuffer,
      writableEnded: false,
      write(chunk: string) {
        chunks.push(chunk)
        return true
      },
    }
    return { sink, chunks }
  }

  it('正常情况写入完整帧', () => {
    const { sink, chunks } = fakeSink()
    const sse = createSseWriter(sink)
    expect(sse.send('task', { id: 'a' })).toBe(true)
    expect(chunks[0]).toBe('event: task\ndata: {"id":"a"}\n\n')
  })

  it('积压超过阈值时丢帧，不继续堆缓冲', () => {
    const { sink, chunks } = fakeSink(2 * 1024 * 1024)
    const sse = createSseWriter(sink)
    expect(sse.send('task', { id: 'a' })).toBe(false)
    expect(chunks).toHaveLength(0)
    expect(sse.droppedFrames).toBe(1)

    // 客户端恢复读取后继续写，计数归零
    sink.writableLength = 0
    expect(sse.send('task', { id: 'b' })).toBe(true)
    expect(sse.droppedFrames).toBe(0)
    expect(chunks).toHaveLength(1)
  })

  it('连续丢帧超限触发断开，且之后不再写', () => {
    const { sink, chunks } = fakeSink(2 * 1024 * 1024)
    const onOverflow = vi.fn()
    const sse = createSseWriter(sink, { maxConsecutiveDrops: 3, onOverflow })
    for (let i = 0; i < 5; i++) sse.send('task', { i })
    expect(onOverflow).toHaveBeenCalledTimes(1)
    expect(sse.closed).toBe(true)
    sink.writableLength = 0
    expect(sse.send('task', { late: true })).toBe(false)
    expect(chunks).toHaveLength(0)
  })
})
