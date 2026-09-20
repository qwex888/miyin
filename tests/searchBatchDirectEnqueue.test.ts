declare global {
  var createError: (input: {
    statusCode?: number
    statusMessage?: string
    message?: string
    data?: unknown
  }) => Error
}

if (!globalThis.createError) {
  globalThis.createError = (input) => {
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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
} from '../server/services/playlistService'
import { closeDb, getDb } from '../server/utils/db'

// 搜索候选返回空：用于验证「无 musicInfo 的曲目」会落到失败项，且失败下标与提交顺序一致
vi.mock('../server/services/platformSearch', () => ({
  searchPlatform: vi.fn(async () => []),
}))

describe('搜索页单曲多选批量入队（tracks 直通）', () => {
  let tmpDir: string
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-search-batch-'))
    process.env.DATA_DIR = tmpDir
    process.env.DOWNLOAD_DIR = tmpDir
    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('src-wy', 'src-wy', 'http://example.com/src-wy.js', '/tmp/src-wy.js', '["wy"]')
  })

  afterEach(() => {
    closeDb()
    vi.clearAllMocks()
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR
    else process.env.DOWNLOAD_DIR = prevDownloadDir
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('带 musicInfo 的多首曲目一次入队，共用同一 batchId 且不建文件夹', async () => {
    const tracks: PlaylistTrackDraft[] = [
      {
        platform: 'wy',
        externalId: '111',
        title: '曲目A',
        artist: '歌手A',
        album: '专辑A',
        duration: 210,
        musicInfo: { source: 'wy', songmid: '111', name: '曲目A', singer: '歌手A' },
      },
      {
        platform: 'wy',
        externalId: '222',
        title: '曲目B',
        artist: '歌手B',
        album: '专辑B',
        duration: 180,
        musicInfo: { source: 'wy', songmid: '222', name: '曲目B', singer: '歌手B' },
      },
      {
        platform: 'wy',
        externalId: '333',
        title: '曲目C',
        artist: '歌手C',
        album: '专辑C',
        duration: 240,
        musicInfo: { source: 'wy', songmid: '333', name: '曲目C', singer: '歌手C' },
      },
    ]

    const res = await matchAndEnqueuePlaylist(
      { platform: 'wy', title: '批量下载', url: '', tracks },
      { quality: 'highest', downloadLyric: true, lyricMode: 'external' },
    )

    expect(res.total).toBe(3)
    expect(res.enqueued).toBe(3)
    expect(res.results).toHaveLength(3)
    expect(res.results.every((r) => r.ok)).toBe(true)

    const rows = getDb()
      .prepare(
        `SELECT external_id, batch_id, quality, music_info_json FROM download_tasks ORDER BY external_id`,
      )
      .all() as Array<{
      external_id: string
      batch_id: string
      quality: string
      music_info_json: string
    }>

    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.batch_id))).toEqual(new Set([res.batchId]))
    expect(rows.every((r) => r.quality === 'highest')).toBe(true)
    // 单曲批量不启用文件夹归档，避免把不同专辑的曲目塞进同一个目录
    expect(rows.every((r) => JSON.parse(r.music_info_json).__folderPrefix === undefined)).toBe(true)
    expect(JSON.parse(rows[0]!.music_info_json).songmid).toBe('111')
  })

  it('未匹配曲目的失败项下标与提交顺序一一对应（供前端重试定位）', async () => {
    const tracks: PlaylistTrackDraft[] = [
      {
        platform: 'wy',
        externalId: '111',
        title: '命中A',
        artist: '歌手A',
        musicInfo: { source: 'wy', songmid: '111', name: '命中A', singer: '歌手A' },
      },
      { platform: 'wy', title: '无音源标识B', artist: '歌手B' },
      {
        platform: 'wy',
        externalId: '333',
        title: '命中C',
        artist: '歌手C',
        musicInfo: { source: 'wy', songmid: '333', name: '命中C', singer: '歌手C' },
      },
    ]

    const res = await matchAndEnqueuePlaylist(
      { platform: 'wy', title: '批量下载', url: '', tracks },
      { quality: 'highest' },
    )

    expect(res.total).toBe(3)
    expect(res.enqueued).toBe(2)
    expect(res.results.map((r) => r.ok)).toEqual([true, false, true])
    expect(res.results[1]!.error).toBeTruthy()
  })
})
