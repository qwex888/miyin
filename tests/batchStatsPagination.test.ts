import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  enqueueDownload,
  batchEnqueueDownload,
  listTasks,
  getTaskStats,
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

describe('PR2 Stats & Batch Ingestion & Pagination Tests', () => {
  let prevDataDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-stats-test-'))
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

  it('performs efficient batch transaction insertion', () => {
    const items = []
    for (let i = 0; i < 50; i++) {
      items.push({
        title: `批量曲目_${i}`,
        artist: '测试歌手',
        platform: 'wy',
        musicInfo: { songmid: `batch_${i}` },
        playlistUrl: 'https://music.163.com/playlist?id=1001',
        batchId: 'batch-001',
      })
    }
    const result = batchEnqueueDownload(items, { silent: true })
    expect(result.total).toBe(50)
    expect(result.enqueued).toBe(50)
    expect(result.ids.length).toBe(50)
    const stats = getTaskStats({ playlistUrl: 'https://music.163.com/playlist?id=1001' })
    expect(stats.total).toBe(50)
    expect(stats.queued + stats.running).toBe(50)
  })

  it('supports accurate task stats aggregation by playlist_url and batch_id', () => {
    batchEnqueueDownload([
      {
        title: '歌单1曲目1',
        artist: '歌手',
        platform: 'wy',
        musicInfo: { songmid: 'p1_1' },
        playlistUrl: 'https://music.163.com/playlist?id=A',
        batchId: 'batch-A',
      },
      {
        title: '歌单1曲目2',
        artist: '歌手',
        platform: 'wy',
        musicInfo: { songmid: 'p1_2' },
        playlistUrl: 'https://music.163.com/playlist?id=A',
        batchId: 'batch-A',
      },
      {
        title: '歌单2曲目1',
        artist: '歌手',
        platform: 'wy',
        musicInfo: { songmid: 'p2_1' },
        playlistUrl: 'https://music.163.com/playlist?id=B',
        batchId: 'batch-B',
      },
    ], { silent: true })

    const globalStats = getTaskStats()
    expect(globalStats.total).toBe(3)
    expect(globalStats.queued + globalStats.running).toBe(3)

    const statsA = getTaskStats({ playlistUrl: 'https://music.163.com/playlist?id=A' })
    expect(statsA.total).toBe(2)
    expect(statsA.queued + statsA.running).toBe(2)

    const statsB = getTaskStats({ batchId: 'batch-B' })
    expect(statsB.total).toBe(1)
    expect(statsB.queued + statsB.running).toBe(1)
  })

  it('supports pagination in listTasks query', () => {
    const tasks = []
    for (let i = 1; i <= 25; i++) {
      tasks.push({
        title: `分页曲目_${i.toString().padStart(2, '0')}`,
        artist: '歌手',
        platform: 'wy',
        musicInfo: { songmid: `page_${i}` },
        playlistUrl: 'https://music.163.com/playlist?id=PAGE',
      })
    }
    batchEnqueueDownload(tasks, { silent: true })

    const page1 = listTasks({ playlistUrl: 'https://music.163.com/playlist?id=PAGE', page: 1, pageSize: 10 })
    expect(page1.length).toBe(10)

    const page2 = listTasks({ playlistUrl: 'https://music.163.com/playlist?id=PAGE', page: 2, pageSize: 10 })
    expect(page2.length).toBe(10)

    const page3 = listTasks({ playlistUrl: 'https://music.163.com/playlist?id=PAGE', page: 3, pageSize: 10 })
    expect(page3.length).toBe(5)
  })
})
