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

async function fetchJson(url: string, init?: RequestInit) {
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
    return await res.json()
  } finally {
    clearTimeout(timer)
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
      },
    }
  })
}

async function searchTx(keyword: string, page: number): Promise<SearchTrack[]> {
  // QQ 音乐公开搜索（轻量；可能偶发失败）
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
        strMediaMid: s.strMediaMid,
        source: 'tx',
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
  const sec = Math.round((ms || 0) / 1000)
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

export const PLATFORM_LABELS: Record<string, string> = {
  wy: '网易云',
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  mg: '咪咕',
}

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
    throw createError({
      statusCode: 502,
      statusMessage: `搜索失败(${PLATFORM_LABELS[platform] || platform}): ${err?.message || err}`,
    })
  }
}

export function listSearchablePlatforms() {
  return Object.keys(adapters)
}
