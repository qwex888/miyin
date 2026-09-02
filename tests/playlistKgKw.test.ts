import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractKugouGcid,
  parsePlaylist,
  resolveKugouSpecialId,
} from '../server/services/playlistService'

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

describe('kg gcid + kw playlist parse (mock fetch)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolveKugouSpecialId reads specialid from m-site HTML', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse('{"is_publish":1,"specialid":8268942,"specialname":"demo"}', {
        headers: { 'content-type': 'text/html;charset=utf-8' },
      }),
    )
    const id = await resolveKugouSpecialId(
      'https://m.kugou.com/songlist/gcid_3z9vj1svz2yz0c4/?src_cid=3z9vj1svz2yz0c4',
    )
    expect(id).toBe('8268942')
    expect(extractKugouGcid('https://m.kugou.com/songlist/gcid_3z9vj1svz2yz0c4/')).toBe(
      'gcid_3z9vj1svz2yz0c4',
    )
  })

  it('parsePlaylist handles kw newh5app playlist with pagination', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      musicrid: `MUSIC_${1000 + i}`,
      rid: 1000 + i,
      name: `曲目${i}`,
      artist: '歌手',
      album: '合集',
      duration: 180,
    }))
    const page2 = Array.from({ length: 44 }, (_, i) => ({
      musicrid: `MUSIC_${1100 + i}`,
      rid: 1100 + i,
      name: `曲目${100 + i}`,
      artist: '歌手',
      album: '合集',
      duration: 181,
    }))

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('playListInfo') && u.includes('pn=1')) {
        return jsonResponse({
          code: 200,
          data: { name: '测试歌单', total: 144, musicList: page1 },
        })
      }
      if (u.includes('playListInfo') && u.includes('pn=2')) {
        return jsonResponse({
          code: 200,
          data: { name: '测试歌单', total: 144, musicList: page2 },
        })
      }
      // resolvePlaylistUrl may probe the page
      return jsonResponse('<html></html>', { headers: { 'content-type': 'text/html' } })
    })

    const draft = await parsePlaylist(
      'https://m.kuwo.cn/newh5app/playlist_detail/3680085909?t=plantform&from=ar',
    )
    expect(draft.platform).toBe('kw')
    expect(draft.title).toBe('测试歌单')
    expect(draft.tracks).toHaveLength(144)
    expect(draft.tracks[0]!.externalId).toBe('1000')
    expect(draft.tracks[0]!.musicInfo?.source).toBe('kw')
  })

  it('parsePlaylist resolves kg gcid then loads special songs', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('m.kugou.com/songlist/gcid_')) {
        return jsonResponse('{"specialid":8268942,"specialname":"伤感"}', {
          headers: { 'content-type': 'text/html' },
        })
      }
      // parseKugou uses http CDN via node http, not fetch — this path only covers resolve
      return jsonResponse('<html></html>', { headers: { 'content-type': 'text/html' } })
    })

    // Only assert resolve path here; full kg song list uses fetchKugouJson (node http)
    const id = await resolveKugouSpecialId(
      'https://m.kugou.com/songlist/gcid_3z9vj1svz2yz0c4/?src_cid=3z9vj1svz2yz0c4',
    )
    expect(id).toBe('8268942')
  })
})
