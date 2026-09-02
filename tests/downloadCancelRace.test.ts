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
import {
  enqueueDownload,
  getTask,
  cancelTask,
  tickWorker,
} from '../server/services/downloadQueue'

describe('downloadQueue cancel race condition', () => {
  let prevDataDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-cancel-race-test-'))
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
  })

  it('prevents cancelled task from being revived to running by processTask', async () => {
    // 1. Enqueue task (status is queued in DB)
    const task = enqueueDownload({
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      platform: 'wy',
      musicInfo: { songmid: '123', name: '晴天', singer: '周杰伦' },
    })

    expect(task.id).toBeTruthy()

    // 2. User cancels the task before/during processing
    const cancelled = cancelTask(task.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error).toBe('用户取消')

    // 3. Trigger worker tick / processTask
    await tickWorker()

    // 4. Assert task remains cancelled in DB and was NEVER revived to running
    const finalTask = getTask(task.id)
    expect(finalTask).toBeDefined()
    expect(finalTask?.status).toBe('cancelled')
    expect(finalTask?.error).toBe('用户取消')
  })

  it('ensures cancelTask while queued aborts execution immediately without revive', async () => {
    const task = enqueueDownload({
      title: '七里香',
      artist: '周杰伦',
      album: '七里香',
      platform: 'wy',
      musicInfo: { songmid: '456', name: '七里香', singer: '周杰伦' },
    })

    // Immediately cancel
    const res = cancelTask(task.id)
    expect(res.status).toBe('cancelled')

    // tickWorker won't pick cancelled tasks because status != 'queued'
    await tickWorker()

    const check = getTask(task.id)
    expect(check?.status).toBe('cancelled')
    expect(check?.error).toBe('用户取消')
  })
})
