declare global {
  var createError: (input: { statusCode?: number; statusMessage?: string; message?: string; data?: unknown }) => Error
}

if (!globalThis.createError) {
  globalThis.createError = (input: { statusCode?: number; statusMessage?: string; message?: string; data?: unknown }) => {
    const err = new Error(input.message || input.statusMessage || 'Error') as Error & {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }
    err.statusCode = input.statusCode
    err.statusMessage = input.statusMessage
    err.data = input.data
    return err
  }
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'

// 受控的取链挂起：允许测试在任务 running 期间执行取消，再放行取链结果
const deferred = vi.hoisted(() => {
  const d: {
    resolve?: (v: { url: string; quality: string; sourceId: string; sourceName: string }) => void
  } = {}
  return d
})

vi.mock('../server/services/musicUrlResolve', () => ({
  isHighestQuality: (pref?: string | null) => !pref || pref === 'highest',
  resolveMusicUrl: vi.fn(
    () =>
      new Promise<{ url: string; quality: string; sourceId: string; sourceName: string }>((resolve) => {
        deferred.resolve = resolve
      }),
  ),
}))

import {
  enqueueDownload,
  getTask,
  cancelTask,
  tickWorker,
  applyStatusTransition,
} from '../server/services/downloadQueue'

async function waitUntil(timeoutMs: number, fn: () => boolean) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return fn()
}

describe('downloadQueue cancelled 为终结态（BUG-02 守护）', () => {
  let prevDataDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-cancel-terminal-'))
    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('test-source-1', '测试音源', 'http://example.com/source.js', '/tmp/fake.js', JSON.stringify(['wy']))
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir) process.env.DATA_DIR = prevDataDir
    else delete process.env.DATA_DIR
    vi.restoreAllMocks()
    deferred.resolve = undefined
  })

  it('场景复现：running 期间取消，取链结果迟到后任务仍保持 cancelled，不得完成', async () => {
    const task = enqueueDownload({
      title: '夜曲',
      artist: '周杰伦',
      album: '十一月的萧邦',
      platform: 'wy',
      downloadLyric: false,
      musicInfo: { songmid: '789', name: '夜曲', singer: '周杰伦' },
    })

    // 启动 worker（取链挂起），等任务进入 running
    void tickWorker()
    const reachedRunning = await waitUntil(3000, () => getTask(task.id)?.status === 'running')
    expect(reachedRunning).toBe(true)

    // 取消（应 abort 并落库 cancelled）
    const cancelled = cancelTask(task.id)
    expect(cancelled.status).toBe('cancelled')

    // 放行迟到的取链结果：processTask 必须在 abort 检查处中止，不得写 completed
    deferred.resolve?.({ url: 'http://example.com/night.flac', quality: 'flac', sourceId: 'test-source-1', sourceName: '测试音源' })
    await waitUntil(3000, () => false) // 给足事件循环时间让 processTask 走完 catch 分支

    const finalTask = getTask(task.id)
    expect(finalTask?.status).toBe('cancelled')
    expect(finalTask?.error).toBe('用户取消')
    expect(finalTask?.file_path).toBeNull()
  })

  it('不变量：cancelled 行不可被状态迁移复活（running/queued/failed/completed 均拒绝）', () => {
    const task = enqueueDownload({
      title: '晴天',
      artist: '周杰伦',
      platform: 'wy',
      downloadLyric: false,
      musicInfo: { songmid: '1', name: '晴天', singer: '周杰伦' },
    })
    cancelTask(task.id)
    expect(getTask(task.id)?.status).toBe('cancelled')

    expect(applyStatusTransition(task.id, { status: 'running' }, ['queued'])).toBe(false)
    expect(applyStatusTransition(task.id, { status: 'queued' }, ['running'])).toBe(false)
    expect(applyStatusTransition(task.id, { status: 'failed' }, ['running'])).toBe(false)
    expect(applyStatusTransition(task.id, { status: 'completed', progress: 1 }, ['running'])).toBe(false)

    expect(getTask(task.id)?.status).toBe('cancelled')
  })

  it('不变量：正常路径 queued → running → completed 的 CAS 迁移可用', () => {
    const task = enqueueDownload({
      title: '七里香',
      artist: '周杰伦',
      platform: 'wy',
      downloadLyric: false,
      musicInfo: { songmid: '2', name: '七里香', singer: '周杰伦' },
    })
    expect(applyStatusTransition(task.id, { status: 'running' }, ['queued'])).toBe(true)
    expect(applyStatusTransition(task.id, { status: 'completed', progress: 1 }, ['running'])).toBe(true)
    expect(getTask(task.id)?.status).toBe('completed')
  })
})
