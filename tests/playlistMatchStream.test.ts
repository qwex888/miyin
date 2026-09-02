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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import {
  matchPlaylistTracks,
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
} from '../server/services/playlistService'
import { closeDb, getDb } from '../server/utils/db'
import { getDbPath } from '../server/utils/paths'

const defaultDataDir = resolve(process.cwd(), 'data')
const defaultDbPath = join(defaultDataDir, 'miyin.sqlite')

function countTrackPollutionInDefaultDb(): number {
  if (!existsSync(defaultDbPath)) return 0
  const db = new Database(defaultDbPath, { readonly: true, fileMustExist: true })
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM download_tasks WHERE title LIKE 'Track %'`)
      .get() as { c: number }
    return row.c
  } finally {
    db.close()
  }
}

describe('matchPlaylistTracks concurrent and abort features', () => {
  let tmpDir: string
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-playlist-match-test-'))
    process.env.DATA_DIR = tmpDir
    process.env.DOWNLOAD_DIR = tmpDir

    expect(resolve(tmpDir)).not.toBe(defaultDataDir)
    expect(getDbPath()).toBe(join(tmpDir, 'miyin.sqlite'))

    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('test-source-1', '测试音源', 'http://example.com/source.js', '/tmp/fake.js', JSON.stringify(['wy']))
  })

  afterEach(() => {
    closeDb()
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

  it('processes manual tracks immediately with allowManualBypass and supports onProgress callback', async () => {
    const tracks: PlaylistTrackDraft[] = [
      {
        platform: 'wy',
        externalId: '101',
        title: '晴天',
        artist: '周杰伦',
        musicInfo: { id: '101' },
      },
      {
        platform: 'wy',
        externalId: '102',
        title: '七里香',
        artist: '周杰伦',
        musicInfo: { id: '102' },
      },
      {
        platform: 'wy',
        externalId: '103',
        title: '青花瓷',
        artist: '周杰伦',
        musicInfo: { id: '103' },
      },
    ]

    const progressLogs: Array<{ index: number; total: number; title: string; score: number }> = []
    const rows = await matchPlaylistTracks(tracks, {
      concurrency: 2,
      allowManualBypass: true,
      onProgress: ({ index, total, track, row }) => {
        progressLogs.push({ index, total, title: track.title, score: row.score })
      },
    })

    expect(rows.length).toBe(3)
    expect(progressLogs.length).toBe(3)
    expect(rows[0]?.selected?.title).toBe('晴天')
    expect(rows[1]?.selected?.title).toBe('七里香')
    expect(rows[2]?.selected?.title).toBe('青花瓷')
  })

  it('supports abort signal to interrupt queue execution early in matchPlaylistTracks', async () => {
    const abortController = new AbortController()

    const tracks: PlaylistTrackDraft[] = Array.from({ length: 50 }, (_, i) => ({
      platform: 'wy',
      externalId: `ext-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      musicInfo: { id: `ext-${i}` },
    }))

    let count = 0
    const matchPromise = matchPlaylistTracks(tracks, {
      concurrency: 1,
      allowManualBypass: true,
      signal: abortController.signal,
      onProgress: () => {
        count++
        if (count >= 5) {
          abortController.abort()
        }
      },
    })

    const rows = await matchPromise
    expect(rows.length).toBeLessThan(50)
    expect(rows.length).toBeGreaterThanOrEqual(5)
  })

  it('supports matchAndEnqueuePlaylist with concurrency, progress events and abort signal', async () => {
    const pollutionBefore = countTrackPollutionInDefaultDb()
    const abortController = new AbortController()
    const tracks: PlaylistTrackDraft[] = Array.from({ length: 20 }, (_, i) => ({
      platform: 'wy',
      externalId: `tid-${i}`,
      title: `Track ${i}`,
      artist: `Singer ${i}`,
      musicInfo: { songmid: `tid-${i}`, name: `Track ${i}`, singer: `Singer ${i}` },
    }))

    const progressEvents: Array<{ index: number; total: number; title: string }> = []
    const res = await matchAndEnqueuePlaylist(
      {
        platform: 'wy',
        title: '测试歌单',
        url: 'https://music.163.com/playlist?id=12345',
        tracks: tracks.slice(0, 5),
      },
      {
        concurrency: 2,
        onProgress: (p) => {
          progressEvents.push({ index: p.index, total: p.total, title: p.title })
        },
      },
    )

    expect(res.enqueued).toBe(5)
    expect(progressEvents.length).toBe(5)
    expect(res.results.length).toBe(5)
    expect(res.results.every((r) => r.ok)).toBe(true)

    const isolatedCount = (
      getDb()
        .prepare(`SELECT COUNT(*) AS c FROM download_tasks WHERE title LIKE 'Track %'`)
        .get() as { c: number }
    ).c
    expect(isolatedCount).toBe(5)
    expect(countTrackPollutionInDefaultDb()).toBe(pollutionBefore)

    let abortCount = 0
    await expect(
      matchAndEnqueuePlaylist(
        {
          platform: 'wy',
          title: '测试中断歌单',
          url: 'https://music.163.com/playlist?id=99999',
          tracks,
        },
        {
          concurrency: 1,
          signal: abortController.signal,
          onProgress: () => {
            abortCount++
            if (abortCount >= 3) {
              abortController.abort()
            }
          },
        },
      ),
    ).rejects.toThrow()

    expect(countTrackPollutionInDefaultDb()).toBe(pollutionBefore)
  })
})
