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
  parsePlaylist,
  type PlaylistTrackDraft,
} from '../server/services/playlistService'
import { closeDb, getDb } from '../server/utils/db'

vi.mock('../server/services/platformSearch', () => ({
  searchPlatform: vi.fn(async () => {
    throw new Error('search should not be called for id direct enqueue')
  }),
}))

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    headers: {
      get: (k: string) => {
        const h = init?.headers || { 'content-type': 'application/json' }
        return h[k.toLowerCase()] || h[k] || null
      },
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response
}

describe('playlist musicInfo + externalId direct enqueue', () => {
  let tmpDir: string
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-playlist-mi-'))
    process.env.DATA_DIR = tmpDir
    process.env.DOWNLOAD_DIR = tmpDir
    const db = getDb()
    for (const [id, platforms] of [
      ['src-wy', '["wy"]'],
      ['src-tx', '["tx"]'],
      ['src-kg', '["kg"]'],
    ] as const) {
      db.prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      ).run(id, id, `http://example.com/${id}.js`, `/tmp/${id}.js`, platforms)
    }
  })

  afterEach(() => {
    closeDb()
    globalThis.fetch = originalFetch
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

  it('parsePlaylist(wy) attaches musicInfo for direct enqueue', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/v6/playlist/detail')) {
        return jsonResponse({
          code: 200,
          playlist: {
            name: '测试网易歌单',
            tracks: [
              {
                id: 3345987903,
                name: '是冬天 是告别',
                ar: [{ name: 'h3R3' }],
                al: { name: '单曲', picUrl: 'https://p1.music.126.net/cover.jpg' },
                dt: 210000,
              },
            ],
            trackIds: [{ id: 3345987903 }],
          },
        })
      }
      return jsonResponse('<html></html>', { headers: { 'content-type': 'text/html' } })
    })

    const draft = await parsePlaylist('https://music.163.com/playlist?id=63754019')
    expect(draft.platform).toBe('wy')
    expect(draft.tracks).toHaveLength(1)
    expect(draft.tracks[0]!.externalId).toBe('3345987903')
    expect(draft.tracks[0]!.musicInfo?.source).toBe('wy')
    expect(draft.tracks[0]!.musicInfo?.songmid).toBe('3345987903')
    expect(draft.tracks[0]!.musicInfo?.img).toBe('https://p1.music.126.net/cover.jpg')
    expect(draft.tracks[0]!.matchMethod).toBe('id')
  })

  it('parsePlaylist(tx) attaches musicInfo for direct enqueue', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('musicu.fcg') && init?.method === 'POST') {
        return jsonResponse({
          req_0: {
            code: 0,
            data: {
              code: 0,
              dirinfo: { title: '测试QQ歌单', songnum: 1 },
              songlist: [
                {
                  mid: '0039MnYb0qxYhV',
                  name: '晴天',
                  singer: [{ name: '周杰伦' }],
                  album: { name: '叶惠美', mid: '000bviBl4F5P1N' },
                  interval: 269,
                },
              ],
            },
          },
        })
      }
      return jsonResponse('<html></html>', { headers: { 'content-type': 'text/html' } })
    })

    const draft = await parsePlaylist('https://y.qq.com/n/ryqq/playlist/8672609904')
    expect(draft.platform).toBe('tx')
    expect(draft.tracks[0]!.externalId).toBe('0039MnYb0qxYhV')
    expect(draft.tracks[0]!.musicInfo?.source).toBe('tx')
    expect(draft.tracks[0]!.musicInfo?.songmid).toBe('0039MnYb0qxYhV')
    expect(draft.tracks[0]!.musicInfo?.img).toBe(
      'https://y.qq.com/music/photo_new/T002R300x300M000000bviBl4F5P1N.jpg',
    )
    expect(draft.tracks[0]!.matchMethod).toBe('id')
  })

  it('matchAndEnqueuePlaylist enqueues by externalId without search', async () => {
    const tracks: PlaylistTrackDraft[] = [
      {
        platform: 'wy',
        externalId: '111',
        title: '曲目A',
        artist: '歌手A',
        album: '专辑A',
      },
      {
        platform: 'tx',
        externalId: '002midXX',
        title: '曲目B',
        artist: '歌手B',
      },
      {
        platform: 'kg',
        externalId: 'ABCDEF0123456789',
        title: '曲目C',
        artist: '歌手C',
      },
    ]

    const res = await matchAndEnqueuePlaylist(
      {
        platform: 'wy',
        title: '直通入队',
        url: 'https://music.163.com/playlist?id=1',
        tracks,
      },
      { concurrency: 2 },
    )

    expect(res.enqueued).toBe(3)
    expect(res.results.every((r) => r.ok)).toBe(true)

    const rows = getDb()
      .prepare(`SELECT platform, external_id, music_info_json FROM download_tasks`)
      .all() as Array<{ platform: string; external_id: string; music_info_json: string }>
    expect(rows).toHaveLength(3)
    const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]))
    expect(JSON.parse(byPlatform.wy!.music_info_json).songmid).toBe('111')
    expect(JSON.parse(byPlatform.tx!.music_info_json).source).toBe('tx')
    expect(JSON.parse(byPlatform.kg!.music_info_json).hash).toBe('ABCDEF0123456789')
    expect(JSON.parse(byPlatform.wy!.music_info_json).__folderPrefix).toBeUndefined()
  })

  it('attaches resolved __folderPrefix when albumDownloadToFolder is enabled', async () => {
    const res = await matchAndEnqueuePlaylist(
      {
        platform: 'wy',
        title: '叶惠美',
        url: 'album://wy/123',
        tracks: [
          {
            platform: 'wy',
            externalId: '186016',
            title: '晴天',
            artist: '周杰伦',
            album: '叶惠美',
          },
        ],
      },
      {
        albumDownloadToFolder: true,
        albumFolderTemplate: '{artist}/{album}',
        albumArtist: '周杰伦',
      },
    )
    expect(res.enqueued).toBe(1)
    const row = getDb()
      .prepare(`SELECT music_info_json FROM download_tasks LIMIT 1`)
      .get() as { music_info_json: string }
    expect(JSON.parse(row.music_info_json).__folderPrefix).toBe('周杰伦/叶惠美')
  })
})
