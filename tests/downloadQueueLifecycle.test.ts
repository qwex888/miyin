import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  enqueueDownload,
  getTask,
  cancelTask,
  listTasks,
} from '../server/services/downloadQueue'

declare global {
  var createError: (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => Error
}

globalThis.createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => {
  const err = new Error(input.statusMessage || 'Error') as Error & {
    statusCode?: number
    data?: unknown
  }
  err.statusCode = input.statusCode
  err.data = input.data
  return err
}

describe('downloadQueue concurrency and lifecycle', () => {
  let prevDataDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-queue-test-'))
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
  })

  it('enqueues task and updates status', () => {
    const task = enqueueDownload({
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      platform: 'wy',
      musicInfo: { songmid: '123', name: '晴天', singer: '周杰伦' },
    })
    expect(task.id).toBeTruthy()
    expect(['queued', 'running']).toContain(task.status)

    const fetched = getTask(task.id)
    expect(fetched?.title).toBe('晴天')
    expect(['queued', 'running', 'failed']).toContain(fetched?.status)
  })

  it('cancels queued task gracefully', () => {
    const task = enqueueDownload({
      title: '七里香',
      artist: '周杰伦',
      album: '七里香',
      platform: 'wy',
      musicInfo: { songmid: '456', name: '七里香', singer: '周杰伦' },
    })
    const cancelled = cancelTask(task.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error).toContain('用户取消')

    const updated = getTask(task.id)
    expect(updated?.status).toBe('cancelled')
  })

  it('lists tasks with status filter', () => {
    const t1 = enqueueDownload({
      title: '歌曲1',
      artist: '歌手1',
      platform: 'wy',
      musicInfo: { songmid: '1' },
    })
    enqueueDownload({
      title: '歌曲2',
      artist: '歌手2',
      platform: 'wy',
      musicInfo: { songmid: '2' },
    })
    cancelTask(t1.id)

    const queued = listTasks('queued')
    const cancelled = listTasks('cancelled')
    expect(queued.length).toBe(1)
    expect(queued[0]?.title).toBe('歌曲2')
    expect(cancelled.length).toBe(1)
    expect(cancelled[0]?.title).toBe('歌曲1')
  })
})
