import { PLATFORM_DISPLAY, platformLabel } from '#shared/platforms'

export type SearchTrack = {
  id: string
  externalId: string
  title: string
  artist: string
  album: string
  duration: number
  platform: string
  cover?: string
  qualitys: string[]
  musicInfo: Record<string, any>
  sourceId?: string
  sourceName?: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchText(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const text = await fetchText(url, init)
  return parseLooseJson(text)
}

/**
 * kw 等接口常返回单引号「伪 JSON」（{'a':'b'}），标准 JSON.parse 会在 position 1 报错。
 * 亦兼容 JSONP / try{var jsondata=...} 包装。
 */
export function parseLooseJson(raw: string): any {
  let text = String(raw || '').trim()
  if (!text) throw new Error('空响应')

  // JSONP / kw 旧客户端: try{var jsondata={...};} / callback({...})
  const jsonp = text.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/)
  if (jsonp) text = jsonp[1]!.trim()
  const kwWrap = text.match(/^\s*try\s*\{\s*var\s+\w+\s*=\s*([\s\S]*?)\s*;?\s*\}\s*(catch[\s\S]*)?$/i)
  if (kwWrap) text = kwWrap[1]!.trim()

  try {
    return JSON.parse(text)
  } catch {
    // 单引号 → 双引号（kw r.s 当前格式；值内极少含未转义单引号）
    const normalized = text.replace(/'/g, '"')
    try {
      return JSON.parse(normalized)
    } catch (err: any) {
      throw new Error(`响应不是合法 JSON: ${err?.message || err}`)
    }
  }
}

function artistsJoin(list: any, key = 'name') {
  if (!list) return '未知'
  if (typeof list === 'string') return cleanArtist(list)
  if (Array.isArray(list)) {
    return cleanArtist(list.map((a) => a?.[key] || a).filter(Boolean).join(' / ') || '未知')
  }
  return cleanArtist(String(list))
}

/** 清洗脏歌手字段：如「周杰伦- / A-LNK」→「周杰伦」 */
export function cleanArtist(raw: string) {
  let s = String(raw || '').trim()
  if (!s) return '未知'
  // 去掉「名- / 后缀」或「名-/后缀」
  s = s.replace(/\s*-\s*\/\s*.+$/, '')
  // 去掉末尾孤立的 - /
  s = s.replace(/[\s\-\/]+$/g, '')
  // 合并多余分隔
  s = s.replace(/\s*\/\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim()
  return s || '未知'
}

async function searchWy(keyword: string, page: number): Promise<SearchTrack[]> {
  const offset = (page - 1) * 30
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&limit=30&offset=${offset}`
  const data = await fetchJson(url, { headers: { Referer: 'https://music.163.com/' } })
  const songs = data?.result?.songs || []
  return songs.map((s: any) => {
    const id = String(s.id)
    return {
      id: `wy:${id}`,
      externalId: id,
      title: s.name || '未知',
      artist: artistsJoin(s.ar || s.artists),
      album: s.al?.name || s.album?.name || '',
      duration: Math.round((s.dt || s.duration || 0) / 1000),
      platform: 'wy',
      cover: s.al?.picUrl || s.album?.picUrl,
      qualitys: ['128k', '320k', 'flac'],
      musicInfo: {
        name: s.name,
        singer: artistsJoin(s.ar || s.artists),
        albumName: s.al?.name || '',
        songmid: id,
        hash: id,
        source: 'wy',
        img: s.al?.picUrl,
        interval: formatInterval(s.dt || s.duration),
      },
    }
  })
}

async function searchKw(keyword: string, page: number): Promise<SearchTrack[]> {
  const url = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&ft=music&client=kt&pn=${page - 1}&rn=30&rformat=json&encoding=utf8`
  const data = await fetchJson(url)
  const abs = data?.abslist || []
  return abs.map((s: any) => {
    const id = String(s.MUSICRID || s.DC_TARGETID || '').replace('MUSIC_', '')
    return {
      id: `kw:${id}`,
      externalId: id,
      title: decode(s.NAME || s.SONGNAME),
      artist: decode(s.ARTIST),
      album: decode(s.ALBUM),
      duration: Number(s.DURATION || 0),
      platform: 'kw',
      cover: s.web_albumpic_short ? `https://img2.kuwo.cn/star/albumcover/${s.web_albumpic_short}` : undefined,
      qualitys: ['128k', '320k'],
      musicInfo: {
        name: decode(s.NAME || s.SONGNAME),
        singer: decode(s.ARTIST),
        albumName: decode(s.ALBUM),
        songmid: id,
        hash: id,
        source: 'kw',
        interval: formatIntervalFromSec(Number(s.DURATION || 0)),
      },
    }
  })
}

async function searchKg(keyword: string, page: number): Promise<SearchTrack[]> {
  const url = `https://complexsearch.kugou.com/v2/search/song?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=30&platform=WebFilter`
  const data = await fetchJson(url)
  const lists = data?.data?.lists || []
  return lists.map((s: any) => {
    const hash = String(s.FileHash || s.HQFileHash || '')
    return {
      id: `kg:${hash}`,
      externalId: hash,
      title: s.SongName || s.OriSongName || '未知',
      artist: s.SingerName || artistsJoin(s.Singers, 'name'),
      album: s.AlbumName || '',
      duration: Number(s.Duration || 0),
      platform: 'kg',
      cover: s.Image?.replace('{size}', '240'),
      qualitys: ['128k', '320k'],
      musicInfo: {
        name: s.SongName,
        singer: s.SingerName,
        albumName: s.AlbumName,
        hash,
        songmid: hash,
        source: 'kg',
        img: s.Image?.replace('{size}', '240'),
        interval: formatIntervalFromSec(Number(s.Duration || 0)),
      },
    }
  })
}

async function searchTx(keyword: string, page: number): Promise<SearchTrack[]> {
  // tx 公开搜索（轻量；可能偶发失败）
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&p=${page}&n=30&format=json`
  const data = await fetchJson(url, { headers: { Referer: 'https://y.qq.com/' } })
  const list = data?.data?.song?.list || []
  return list.map((s: any) => {
    const mid = String(s.songmid || s.mid)
    return {
      id: `tx:${mid}`,
      externalId: mid,
      title: s.songname || s.name || '未知',
      artist: artistsJoin(s.singer),
      album: s.albumname || '',
      duration: Number(s.interval || 0),
      platform: 'tx',
      cover: s.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg` : undefined,
      qualitys: ['128k', '320k'],
      musicInfo: {
        name: s.songname,
        singer: artistsJoin(s.singer),
        albumName: s.albumname,
        songmid: mid,
        hash: mid,
        songid: s.songid || s.id,
        strMediaMid: s.strMediaMid,
        source: 'tx',
        interval: formatIntervalFromSec(Number(s.interval || 0)),
      },
    }
  })
}

function decode(s: any) {
  if (s == null) return ''
  try {
    return decodeURIComponent(String(s).replace(/\+/g, '%20'))
  } catch {
    return String(s)
  }
}

function formatInterval(ms: number) {
  return formatIntervalFromSec(Math.round((ms || 0) / 1000))
}

function formatIntervalFromSec(secRaw: number) {
  const sec = Math.max(0, Math.round(secRaw || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const adapters: Record<string, (kw: string, page: number) => Promise<SearchTrack[]>> = {
  wy: searchWy,
  kw: searchKw,
  kg: searchKg,
  tx: searchTx,
}

export const PLATFORM_LABELS = PLATFORM_DISPLAY

const searchCache = new Map<string, { at: number; items: SearchTrack[] }>()
const SEARCH_TTL_MS = 60_000

export function clearSearchCache() {
  searchCache.clear()
}

export async function searchPlatform(platform: string, keyword: string, page = 1) {
  const fn = adapters[platform]
  if (!fn) throw createError({ statusCode: 400, statusMessage: `暂不支持平台: ${platform}` })
  if (!keyword.trim()) throw createError({ statusCode: 400, statusMessage: '请输入关键词' })
  const key = `${platform}:${keyword.trim()}:${page}`
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.items
  try {
    const items = await fn(keyword.trim(), page)
    // 统一再清洗一遍
    for (const it of items) {
      it.artist = cleanArtist(it.artist)
      if (it.musicInfo) it.musicInfo.singer = cleanArtist(it.musicInfo.singer || it.artist)
    }
    searchCache.set(key, { at: Date.now(), items })
    return items
  } catch (err: any) {
    // statusMessage 只能是短英文 reason phrase；详情放 message，避免出现「502 (): ...」
    const detail = String(err?.message || err || 'unknown')
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `搜索失败(${platformLabel(platform)}): ${detail}`,
      data: { platform, reason: detail },
    })
  }
}

export function listSearchablePlatforms() {
  return Object.keys(adapters)
}
