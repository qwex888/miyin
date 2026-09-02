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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchPlatform, clearSearchCache } from '../server/services/platformSearch'

type CustomError = Error & { statusCode?: number; statusMessage?: string; data?: unknown }

describe('platformSearch variable declarations and adapter mapping (offline deterministic tests)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearSearchCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('maps wy (NetEase) response correctly and provides complete fields without ReferenceError', async () => {
    const mockWyResponse = {
      result: {
        songs: [
          {
            id: 186016,
            name: '晴天',
            ar: [{ id: 6452, name: '周杰伦' }],
            al: { id: 18896, name: '叶惠美', picUrl: 'https://p1.music.126.net/cover.jpg' },
            dt: 269000,
          },
        ],
      },
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockWyResponse),
    } as Response)

    const res = await searchPlatform('wy', '晴天', 1)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(1)

    const track = res[0]
    expect(track.id).toBe('wy:186016')
    expect(track.externalId).toBe('186016')
    expect(track.title).toBe('晴天')
    expect(track.artist).toBe('周杰伦')
    expect(track.album).toBe('叶惠美')
    expect(track.duration).toBe(269)
    expect(track.platform).toBe('wy')
    expect(track.cover).toBe('https://p1.music.126.net/cover.jpg')
    expect(track.qualitys).toEqual(['128k', '320k', 'flac'])
    expect(track.musicInfo).toBeDefined()
    expect(track.musicInfo.source).toBe('wy')
    expect(track.musicInfo.songmid).toBe('186016')
    expect(track.musicInfo.hash).toBe('186016')
    expect(track.musicInfo.name).toBe('晴天')
    expect(track.musicInfo.singer).toBe('周杰伦')
    expect(track.musicInfo.albumName).toBe('叶惠美')
  })

  it('maps kw (Kuwo) response correctly with loose JSON/id without ReferenceError', async () => {
    // kuwo responses often use MUSICRID or DC_TARGETID
    const mockKwResponse = {
      abslist: [
        {
          MUSICRID: 'MUSIC_348424',
          NAME: '晴天',
          ARTIST: '周杰伦',
          ALBUM: '叶惠美',
          DURATION: '269',
          web_albumpic_short: '12345.jpg',
        },
      ],
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockKwResponse),
    } as Response)

    const res = await searchPlatform('kw', '晴天', 1)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(1)

    const track = res[0]
    expect(track.id).toBe('kw:348424')
    expect(track.externalId).toBe('348424')
    expect(track.title).toBe('晴天')
    expect(track.artist).toBe('周杰伦')
    expect(track.album).toBe('叶惠美')
    expect(track.duration).toBe(269)
    expect(track.platform).toBe('kw')
    expect(track.cover).toBe('https://img2.kuwo.cn/star/albumcover/12345.jpg')
    expect(track.musicInfo).toBeDefined()
    expect(track.musicInfo.source).toBe('kw')
    expect(track.musicInfo.songmid).toBe('348424')
    expect(track.musicInfo.hash).toBe('348424')
    expect(track.musicInfo.name).toBe('晴天')
    expect(track.musicInfo.singer).toBe('周杰伦')
  })

  it('maps kg (Kugou) response correctly with FileHash without ReferenceError', async () => {
    const mockKgResponse = {
      data: {
        lists: [
          {
            FileHash: 'ABCDEF1234567890ABCDEF1234567890',
            SongName: '晴天',
            SingerName: '周杰伦',
            AlbumName: '叶惠美',
            Duration: 269,
            Image: 'https://imge.kugou.com/{size}/cover.jpg',
          },
        ],
      },
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockKgResponse),
    } as Response)

    const res = await searchPlatform('kg', '晴天', 1)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(1)

    const track = res[0]
    expect(track.id).toBe('kg:ABCDEF1234567890ABCDEF1234567890')
    expect(track.externalId).toBe('ABCDEF1234567890ABCDEF1234567890')
    expect(track.title).toBe('晴天')
    expect(track.artist).toBe('周杰伦')
    expect(track.album).toBe('叶惠美')
    expect(track.duration).toBe(269)
    expect(track.platform).toBe('kg')
    expect(track.cover).toBe('https://imge.kugou.com/240/cover.jpg')
    expect(track.musicInfo).toBeDefined()
    expect(track.musicInfo.source).toBe('kg')
    expect(track.musicInfo.hash).toBe('ABCDEF1234567890ABCDEF1234567890')
    expect(track.musicInfo.songmid).toBe('ABCDEF1234567890ABCDEF1234567890')
  })

  it('maps tx (Tencent/QQ) response correctly with songmid/mid without ReferenceError', async () => {
    const mockTxResponse = {
      data: {
        song: {
          list: [
            {
              songmid: '0039MnYb0qxYgn',
              songname: '晴天',
              singer: [{ name: '周杰伦' }],
              albumname: '叶惠美',
              albummid: '000bviBl4F5P1N',
              interval: 269,
              songid: 107192078,
              strMediaMid: '0039MnYb0qxYgn',
            },
          ],
        },
      },
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockTxResponse),
    } as Response)

    const res = await searchPlatform('tx', '晴天', 1)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(1)

    const track = res[0]
    expect(track.id).toBe('tx:0039MnYb0qxYgn')
    expect(track.externalId).toBe('0039MnYb0qxYgn')
    expect(track.title).toBe('晴天')
    expect(track.artist).toBe('周杰伦')
    expect(track.album).toBe('叶惠美')
    expect(track.duration).toBe(269)
    expect(track.platform).toBe('tx')
    expect(track.cover).toBe('https://y.qq.com/music/photo_new/T002R300x300M000000bviBl4F5P1N.jpg')
    expect(track.musicInfo).toBeDefined()
    expect(track.musicInfo.source).toBe('tx')
    expect(track.musicInfo.songmid).toBe('0039MnYb0qxYgn')
    expect(track.musicInfo.songid).toBe(107192078)
  })

  it('throws structured error via createError when input is invalid or unsupported', async () => {
    await expect(searchPlatform('unsupported', '晴天')).rejects.toSatisfy((err: unknown) => {
      const e = err as CustomError
      expect(e.statusCode).toBe(400)
      expect(e.statusMessage).toContain('暂不支持平台')
      return true
    })

    await expect(searchPlatform('wy', '   ')).rejects.toSatisfy((err: unknown) => {
      const e = err as CustomError
      expect(e.statusCode).toBe(400)
      expect(e.statusMessage).toContain('请输入关键词')
      return true
    })
  })

  it('throws structured 502 error via createError when network or upstream fails without throwing ReferenceError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network connection failed'))

    await expect(searchPlatform('wy', '晴天')).rejects.toSatisfy((err: unknown) => {
      const e = err as CustomError
      expect(e.name).not.toBe('ReferenceError')
      expect(e.statusCode).toBe(502)
      expect(e.statusMessage).toBe('Bad Gateway')
      expect(e.message).toContain('搜索失败')
      return true
    })
  })
})
