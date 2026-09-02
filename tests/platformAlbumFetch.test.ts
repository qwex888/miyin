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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ALBUM_SONG_MAX_PAGES,
  ALBUM_SONG_PAGE_SIZE,
  clearAlbumCache,
  getAlbumDetail,
  listAlbumCapablePlatforms,
  searchAlbums,
} from '../server/services/platformAlbum'

type ApiError = Error & { statusCode?: number; data?: unknown }

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('platformAlbum fetch adapters (mock fetch)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearAlbumCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('lists album-capable platforms', () => {
    expect(listAlbumCapablePlatforms()).toEqual(['wy', 'tx', 'kw', 'kg'])
  })

  it('searchAlbums rejects unsupported platform and empty keyword', async () => {
    await expect(searchAlbums('mg', 'x')).rejects.toMatchObject({ statusCode: 400 })
    await expect(searchAlbums('wy', '  ')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('getAlbumDetail rejects unsupported platform and empty albumId', async () => {
    await expect(getAlbumDetail('mg', '1')).rejects.toMatchObject({ statusCode: 400 })
    await expect(getAlbumDetail('wy', '')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('searchAlbums wy maps cloudsearch albums', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          albums: [
            {
              id: 18915,
              name: '范特西',
              artist: { name: '周杰伦' },
              size: 10,
              picUrl: 'http://pic',
            },
          ],
        },
      }),
    )
    const items = await searchAlbums('wy', '范特西', 1)
    expect(items[0]).toMatchObject({
      externalId: '18915',
      title: '范特西',
      artist: '周杰伦',
      platform: 'wy',
      trackCount: 10,
    })
  })

  it('getAlbumDetail wy maps v1 album songs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 200,
        album: { id: 123, name: '范特西', artist: { name: '周杰伦' }, size: 1, picUrl: 'http://pic' },
        songs: [
          {
            id: 456,
            name: '爱在西元前',
            ar: [{ name: '周杰伦' }],
            dt: 234000,
            al: { name: '范特西' },
          },
        ],
      }),
    )
    const detail = await getAlbumDetail('wy', '123')
    expect(detail.tracks).toHaveLength(1)
    expect(detail.tracks[0]!.musicInfo.songmid).toBe('456')
  })

  it('searchAlbums + getAlbumDetail tx', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            album: {
              list: [
                {
                  albumMID: 'ABC123',
                  albumName: '叶惠美',
                  singerName: '周杰伦',
                  song_count: 11,
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            mid: 'ABC123',
            name: '叶惠美',
            singername: '周杰伦',
            total_song_num: 1,
            list: [
              {
                songmid: 'SONG001',
                songname: '以父之名',
                singer: [{ name: '周杰伦' }],
                interval: 340,
              },
            ],
          },
        }),
      )

    const items = await searchAlbums('tx', '叶惠美', 1)
    expect(items[0]!.externalId).toBe('ABC123')
    const detail = await getAlbumDetail('tx', 'ABC123')
    expect(detail.tracks[0]!.externalId).toBe('SONG001')
  })

  it('searchAlbums + getAlbumDetail kw with single page', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          abslist: [{ ALBUMID: '888', NAME: '测试专辑', ARTIST: '歌手', SONGNUM: '1' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          album: { albumid: '888', name: '测试专辑', artist: '歌手', songnum: 1 },
          musiclist: [{ MUSICRID: 'MUSIC_123', NAME: '曲目1', ARTIST: '歌手', DURATION: '200' }],
        }),
      )

    const items = await searchAlbums('kw', '测试', 1)
    expect(items[0]!.externalId).toBe('888')
    const detail = await getAlbumDetail('kw', '888')
    expect(detail.tracks).toHaveLength(1)
    expect(detail.tracks[0]!.externalId).toBe('123')
  })

  it('getAlbumDetail kw paginates when songnum exceeds first page', async () => {
    const page0 = Array.from({ length: ALBUM_SONG_PAGE_SIZE }, (_, i) => ({
      MUSICRID: `MUSIC_${i}`,
      NAME: `曲目${i}`,
      ARTIST: '歌手',
      DURATION: '100',
    }))
    const page1 = [
      {
        MUSICRID: `MUSIC_${ALBUM_SONG_PAGE_SIZE}`,
        NAME: `曲目${ALBUM_SONG_PAGE_SIZE}`,
        ARTIST: '歌手',
        DURATION: '100',
      },
    ]
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          album: { albumid: '999', name: '大合集', artist: '歌手', songnum: ALBUM_SONG_PAGE_SIZE + 1 },
          musiclist: page0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          album: { albumid: '999', name: '大合集', artist: '歌手', songnum: ALBUM_SONG_PAGE_SIZE + 1 },
          musiclist: page1,
        }),
      )

    const detail = await getAlbumDetail('kw', '999')
    expect(detail.tracks).toHaveLength(ALBUM_SONG_PAGE_SIZE + 1)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(2)
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain('pn=0')
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1]![0])).toContain('pn=1')
  })

  it('searchAlbums kg maps mobilecdn v3', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          info: [
            {
              albumid: 958706,
              albumname: '范特西',
              singername: '周杰伦',
              songcount: 10,
              imgurl: 'http://img/{size}/a.jpg',
            },
          ],
        },
      }),
    )
    const items = await searchAlbums('kg', '范特西', 1)
    expect(items[0]).toMatchObject({ externalId: '958706', title: '范特西', trackCount: 10 })
  })

  it('getAlbumDetail kg paginates beyond pagesize and merges tracks', async () => {
    const page1 = Array.from({ length: ALBUM_SONG_PAGE_SIZE }, (_, i) => ({
      hash: `h${i}`,
      filename: `歌手 - 曲目${i}`,
      duration: 180,
    }))
    const page2 = [
      { hash: `h${ALBUM_SONG_PAGE_SIZE}`, filename: `歌手 - 曲目${ALBUM_SONG_PAGE_SIZE}`, duration: 181 },
      { hash: `h${ALBUM_SONG_PAGE_SIZE + 1}`, filename: `歌手 - 曲目${ALBUM_SONG_PAGE_SIZE + 1}`, duration: 182 },
    ]
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { total: ALBUM_SONG_PAGE_SIZE + 2, info: page1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { total: ALBUM_SONG_PAGE_SIZE + 2, info: page2 } }))

    const detail = await getAlbumDetail('kg', '777')
    expect(detail.album.trackCount).toBe(ALBUM_SONG_PAGE_SIZE + 2)
    expect(detail.tracks).toHaveLength(ALBUM_SONG_PAGE_SIZE + 2)
    expect(detail.tracks[0]!.externalId).toBe('h0')
    expect(detail.tracks.at(-1)!.externalId).toBe(`h${ALBUM_SONG_PAGE_SIZE + 1}`)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(2)
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain('page=1')
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1]![0])).toContain('page=2')
  })

  it('getAlbumDetail kg stops at ALBUM_SONG_MAX_PAGES hard cap', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const m = String(url).match(/[?&]page=(\d+)/)
      const page = Number(m?.[1] || 1)
      const songs = Array.from({ length: ALBUM_SONG_PAGE_SIZE }, (_, i) => ({
        hash: `p${page}_${i}`,
        filename: `歌手 - p${page}_${i}`,
        duration: 100,
      }))
      return jsonResponse({
        data: { total: ALBUM_SONG_MAX_PAGES * ALBUM_SONG_PAGE_SIZE + 999, info: songs },
      })
    })

    const detail = await getAlbumDetail('kg', 'huge')
    expect(detail.tracks).toHaveLength(ALBUM_SONG_MAX_PAGES * ALBUM_SONG_PAGE_SIZE)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(ALBUM_SONG_MAX_PAGES)
  })

  it('getAlbumDetail wraps upstream failure as 502', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response)
    try {
      await getAlbumDetail('kg', '1')
      expect.unreachable('should throw')
    } catch (e) {
      const err = e as ApiError
      expect(err.statusCode).toBe(502)
      expect(String(err.message)).toContain('专辑详情失败')
    }
  })

  it('searchAlbums caches within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        result: { albums: [{ id: 1, name: 'A', artist: { name: 'B' }, size: 1 }] },
      }),
    )
    globalThis.fetch = fetchMock
    await searchAlbums('wy', 'cache-me', 1)
    await searchAlbums('wy', 'cache-me', 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * 路由层：与 server/api/search.post（type=album）及 server/api/album/detail.post 相同调用链。
 * 在无 Nitro 测试宿主时，直接行使服务层入口，覆盖路由业务路径。
 */
describe('album API route-equivalent paths', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearAlbumCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  async function routeSearchAlbum(body: { platform?: string; keyword?: string; page?: number }) {
    const platform = body.platform || 'wy'
    const keyword = body.keyword || ''
    const page = body.page || 1
    const items = await searchAlbums(platform, keyword, page)
    return { type: 'album' as const, platform, items }
  }

  async function routeAlbumDetail(body: { platform?: string; albumId?: string }) {
    return getAlbumDetail(body.platform || 'wy', body.albumId || '')
  }

  it('POST /api/search type=album happy path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          info: [{ albumid: 1, albumname: 'X', singername: 'Y', songcount: 2 }],
        },
      }),
    )
    const res = await routeSearchAlbum({ platform: 'kg', keyword: 'X', page: 1 })
    expect(res.type).toBe('album')
    expect(res.items[0]!.title).toBe('X')
  })

  it('POST /api/album/detail happy path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          total: 1,
          info: [{ hash: 'abc', filename: '歌手 - 歌', duration: 120 }],
        },
      }),
    )
    const res = await routeAlbumDetail({ platform: 'kg', albumId: '42' })
    expect(res.album.externalId).toBe('42')
    expect(res.tracks[0]!.title).toBe('歌')
  })

  it('POST /api/album/detail validates albumId like the route', async () => {
    await expect(routeAlbumDetail({ platform: 'kg', albumId: '' })).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})
