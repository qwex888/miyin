import { platformLabel } from '#shared/platforms'
import {
  cleanArtist,
  parseLooseJson,
  type SearchTrack,
} from './platformSearch'

export type SearchAlbum = {
  id: string
  externalId: string
  title: string
  artist: string
  trackCount?: number
  cover?: string
  platform: string
  publishTime?: string
}

export type AlbumDetail = {
  album: SearchAlbum
  tracks: SearchTrack[]
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const QQ_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://y.qq.com/',
}

/** 一期 wy/tx/kw；二期含 kg */
export const ALBUM_CAPABLE_PLATFORMS = ['wy', 'tx', 'kw', 'kg'] as const
export type AlbumCapablePlatform = (typeof ALBUM_CAPABLE_PLATFORMS)[number]

export function listAlbumCapablePlatforms(): AlbumCapablePlatform[] {
  return [...ALBUM_CAPABLE_PLATFORMS]
}

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

function artistsJoin(list: any, key = 'name') {
  if (!list) return '未知'
  if (typeof list === 'string') return cleanArtist(list)
  if (Array.isArray(list)) {
    return cleanArtist(
      list
        .map((a) => {
          if (a == null) return ''
          if (typeof a === 'string') return a
          if (typeof a === 'object') return a[key] || a.name || ''
          return String(a)
        })
        .filter(Boolean)
        .join(' / ') || '未知',
    )
  }
  // wy cloudsearch 专辑 artist 常为单对象 { name }
  if (typeof list === 'object') {
    const name = list[key] || list.name
    if (name) return cleanArtist(String(name))
  }
  return cleanArtist(String(list))
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

function polishTracks(tracks: SearchTrack[]) {
  for (const it of tracks) {
    it.artist = cleanArtist(it.artist)
    if (it.musicInfo) it.musicInfo.singer = cleanArtist(it.musicInfo.singer || it.artist)
  }
  return tracks
}

/** wy 专辑搜索结果映射（供单测） */
export function mapWySearchAlbums(raw: any[]): SearchAlbum[] {
  return (raw || []).map((a: any) => {
    const id = String(a.id)
    // artists 为数组更稳；artist 常为单对象，勿 String(obj)
    const artist = artistsJoin(a.artists?.length ? a.artists : a.artist)
    const trackCount = Number(a.size ?? a.songCount ?? 0) || undefined
    return {
      id: `wy:${id}`,
      externalId: id,
      title: a.name || '未知',
      artist,
      trackCount,
      cover: a.picUrl || a.blurPicUrl,
      platform: 'wy',
      publishTime: a.publishTime ? String(a.publishTime) : undefined,
    }
  })
}

/** wy 单曲映射（专辑详情曲目，与单曲搜索同形 musicInfo） */
export function mapWySong(s: any, albumTitle = '', albumCover?: string): SearchTrack {
  const id = String(s.id)
  const cover = s.al?.picUrl || albumCover
  return {
    id: `wy:${id}`,
    externalId: id,
    title: s.name || '未知',
    artist: artistsJoin(s.ar || s.artists),
    album: s.al?.name || albumTitle || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
    platform: 'wy',
    cover,
    qualitys: ['128k', '320k', 'flac'],
    musicInfo: {
      name: s.name,
      singer: artistsJoin(s.ar || s.artists),
      albumName: s.al?.name || albumTitle || '',
      songmid: id,
      hash: id,
      source: 'wy',
      img: cover,
      interval: formatInterval(s.dt || s.duration),
    },
  }
}

/** wy 专辑详情映射（供单测）；兼容 /api/v1/album 响应 */
export function mapWyAlbumDetail(data: any): AlbumDetail {
  const albumRaw = data?.album || data
  const albumId = String(albumRaw?.id || '')
  const albumTitle = albumRaw?.name || '未知'
  const cover = albumRaw?.picUrl || albumRaw?.blurPicUrl
  const songs = data?.songs || albumRaw?.songs || []
  const artist = artistsJoin(
    albumRaw?.artists?.length ? albumRaw.artists : albumRaw?.artist,
  )
  const album: SearchAlbum = {
    id: `wy:${albumId}`,
    externalId: albumId,
    title: albumTitle,
    artist,
    trackCount: Number(albumRaw?.size ?? songs.length) || songs.length || undefined,
    cover,
    platform: 'wy',
    publishTime: albumRaw?.publishTime ? String(albumRaw.publishTime) : undefined,
  }
  const tracks = polishTracks(songs.map((s: any) => mapWySong(s, albumTitle, cover)))
  return { album, tracks }
}

async function searchWyAlbums(keyword: string, page: number): Promise<SearchAlbum[]> {
  const offset = (page - 1) * 30
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=10&limit=30&offset=${offset}`
  const data = await fetchJson(url, { headers: { Referer: 'https://music.163.com/' } })
  return mapWySearchAlbums(data?.result?.albums || [])
}

async function getWyAlbumDetail(albumId: string): Promise<AlbumDetail> {
  // /api/album/{id} 常返回 -462（需绑手机）；v1 可直接拿 songs
  const url = `https://music.163.com/api/v1/album/${encodeURIComponent(albumId)}`
  const data = await fetchJson(url, { headers: { Referer: 'https://music.163.com/' } })
  if (data?.code && data.code !== 200) {
    throw new Error(data.msg || data.message || data?.data?.blockText || `code ${data.code}`)
  }
  const detail = mapWyAlbumDetail(data)
  if (!detail.tracks.length) throw new Error('专辑曲目为空')
  return detail
}

/** tx 专辑搜索映射（client_search_cp t=8 字段多为 albumMID / singerName） */
export function mapTxSearchAlbums(raw: any[]): SearchAlbum[] {
  return (raw || []).map((a: any) => {
    const mid = String(a.albumMID || a.albummid || a.album_mid || a.mid || '')
    const artist =
      a.singerName ||
      artistsJoin(a.singer_list || a.singer) ||
      '未知'
    const trackCount = Number(a.song_count ?? a.songnum ?? 0) || undefined
    const cover =
      a.albumPic ||
      (mid ? `https://y.qq.com/music/photo_new/T002R300x300M000${mid}.jpg` : undefined)
    return {
      id: `tx:${mid}`,
      externalId: mid,
      title: a.albumName || a.albumname || a.name || '未知',
      artist: cleanArtist(String(artist)),
      trackCount,
      cover,
      platform: 'tx',
      publishTime: a.publicTime || a.pubtime ? String(a.publicTime || a.pubtime) : undefined,
    }
  })
}

/** tx 专辑详情曲目映射（含完整 musicInfo） */
export function mapTxAlbumSong(s: any, albumTitle = '', albummid = ''): SearchTrack {
  const mid = String(s.songmid || s.mid || '')
  const cover = albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albummid}.jpg` : undefined
  return {
    id: `tx:${mid}`,
    externalId: mid,
    title: s.songname || s.name || '未知',
    artist: artistsJoin(s.singer),
    album: s.albumname || albumTitle || '',
    duration: Number(s.interval || 0),
    platform: 'tx',
    cover,
    qualitys: ['128k', '320k'],
    musicInfo: {
      name: s.songname || s.name,
      singer: artistsJoin(s.singer),
      albumName: s.albumname || albumTitle || '',
      songmid: mid,
      hash: mid,
      songid: s.songid || s.id,
      strMediaMid: s.strMediaMid || s.media_mid,
      source: 'tx',
      interval: formatIntervalFromSec(Number(s.interval || 0)),
    },
  }
}

export function mapTxAlbumDetail(data: any, albumId: string): AlbumDetail {
  const info = data?.data || data
  const albummid = String(info?.mid || albumId)
  const albumTitle = info?.name || info?.title || '未知'
  const cover = albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albummid}.jpg` : undefined
  const list = info?.list || info?.songlist || []
  // 详情接口歌手多为 singername 字符串，不是 singer 数组
  const artist =
    info?.singername ||
    artistsJoin(info?.singer) ||
    '未知'
  const album: SearchAlbum = {
    id: `tx:${albummid}`,
    externalId: albummid,
    title: albumTitle,
    artist: cleanArtist(String(artist)),
    trackCount: Number(info?.total_song_num ?? list.length) || list.length || undefined,
    cover,
    platform: 'tx',
    publishTime: info?.aDate || info?.pub_time ? String(info?.aDate || info?.pub_time) : undefined,
  }
  const tracks = polishTracks(list.map((s: any) => mapTxAlbumSong(s, albumTitle, albummid)))
  return { album, tracks }
}

async function searchTxAlbums(keyword: string, page: number): Promise<SearchAlbum[]> {
  // 带 new_json/aggr 等参数时 album.list 常为空；精简参数与单曲搜索一致更稳
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?` +
    `w=${encodeURIComponent(keyword)}&p=${page}&n=30&format=json&t=8`
  const data = await fetchJson(url, { headers: QQ_HEADERS })
  return mapTxSearchAlbums(data?.data?.album?.list || [])
}

async function getTxAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const url =
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?` +
    `albummid=${encodeURIComponent(albumId)}&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`
  const data = await fetchJson(url, { headers: QQ_HEADERS })
  const detail = mapTxAlbumDetail(data, albumId)
  if (!detail.tracks.length) throw new Error('专辑曲目为空')
  return detail
}

/** kw 专辑搜索映射 */
export function mapKwSearchAlbums(raw: any[]): SearchAlbum[] {
  return (raw || []).map((a: any) => {
    const id = String(a.ALBUMID || a.albumid || a.id || '').replace(/^ALBUM_/, '')
    const pic = a.web_albumpic_short || a.pic
    return {
      id: `kw:${id}`,
      externalId: id,
      title: decode(a.NAME || a.ALBUM || a.name || '未知'),
      artist: decode(a.ARTIST || a.artist || '未知'),
      trackCount: a.SONGNUM ? Number(a.SONGNUM) : undefined,
      cover: pic ? `https://img2.kuwo.cn/star/albumcover/${pic}` : undefined,
      platform: 'kw',
      publishTime: a.RELEASEDATE || a.releaseDate ? String(a.RELEASEDATE || a.releaseDate) : undefined,
    }
  })
}

export function mapKwAlbumSong(s: any, albumTitle = ''): SearchTrack {
  const id = String(s.MUSICRID || s.DC_TARGETID || s.id || '').replace('MUSIC_', '')
  const pic = s.web_albumpic_short
  return {
    id: `kw:${id}`,
    externalId: id,
    title: decode(s.NAME || s.SONGNAME || s.name),
    artist: decode(s.ARTIST || s.artist),
    album: decode(s.ALBUM || albumTitle),
    duration: Number(s.DURATION || s.duration || 0),
    platform: 'kw',
    cover: pic ? `https://img2.kuwo.cn/star/albumcover/${pic}` : undefined,
    qualitys: ['128k', '320k'],
    musicInfo: {
      name: decode(s.NAME || s.SONGNAME || s.name),
      singer: decode(s.ARTIST || s.artist),
      albumName: decode(s.ALBUM || albumTitle),
      songmid: id,
      hash: id,
      source: 'kw',
      interval: formatIntervalFromSec(Number(s.DURATION || s.duration || 0)),
    },
  }
}

export function mapKwAlbumDetail(data: any, albumId: string): AlbumDetail {
  const albumRaw = data?.album || data?.data?.album || {}
  const id = String(albumRaw?.albumid || albumRaw?.id || albumId)
  const albumTitle = decode(albumRaw?.name || albumRaw?.ALBUM || '未知')
  const pic = albumRaw?.pic || albumRaw?.web_albumpic_short
  const album: SearchAlbum = {
    id: `kw:${id}`,
    externalId: id,
    title: albumTitle,
    artist: decode(albumRaw?.artist || albumRaw?.ARTIST || '未知'),
    trackCount: albumRaw?.songnum ? Number(albumRaw.songnum) : undefined,
    cover: pic ? `https://img2.kuwo.cn/star/albumcover/${pic}` : undefined,
    platform: 'kw',
  }
  const songList = data?.musiclist || data?.data?.musiclist || data?.abslist || []
  const tracks = polishTracks(songList.map((s: any) => mapKwAlbumSong(s, albumTitle)))
  return { album, tracks }
}

async function searchKwAlbums(keyword: string, page: number): Promise<SearchAlbum[]> {
  const url = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&ft=album&client=kt&pn=${page - 1}&rn=30&rformat=json&encoding=utf8`
  const data = await fetchJson(url)
  return mapKwSearchAlbums(data?.abslist || data?.albumlist || [])
}

async function getKwAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const url = `https://search.kuwo.cn/r.s?stype=albuminfo&albumid=${encodeURIComponent(albumId)}&encoding=utf8&rformat=json`
  const data = await fetchJson(url)
  const detail = mapKwAlbumDetail(data, albumId)
  if (!detail.tracks.length) throw new Error('专辑曲目为空')
  return detail
}

/** kg 专辑搜索映射（mobilecdn v3：albumid / albumname / singername / songcount / imgurl） */
export function mapKgSearchAlbums(raw: any[]): SearchAlbum[] {
  return (raw || []).map((a: any) => {
    const id = String(a.AlbumID || a.albumid || a.album_id || '')
    const img = a.imgurl || a.Image || a.album_img
    return {
      id: `kg:${id}`,
      externalId: id,
      title: a.AlbumName || a.albumname || '未知',
      artist: cleanArtist(String(a.SingerName || a.singername || artistsJoin(a.singer) || '未知')),
      trackCount: Number(a.SongCount ?? a.songcount ?? 0) || undefined,
      cover: typeof img === 'string' ? img.replace('{size}', '240') : undefined,
      platform: 'kg',
      publishTime: a.PublishTime || a.publishtime ? String(a.PublishTime || a.publishtime) : undefined,
    }
  })
}

/** kg 专辑曲目：filename 多为「歌手 - 歌名」，hash/duration 小写 */
export function mapKgAlbumSong(s: any, albumTitle = ''): SearchTrack {
  const hash = String(s.FileHash || s.HQFileHash || s.hash || '')
  let title = s.SongName || s.OriSongName || s.name || s.songname || ''
  let artist = s.SingerName || s.singername || artistsJoin(s.Singers, 'name')
  if ((!title || title === '未知') && s.filename) {
    const fn = String(s.filename)
    const sep = fn.indexOf(' - ')
    if (sep > 0) {
      artist = artist && artist !== '未知' ? artist : fn.slice(0, sep)
      title = fn.slice(sep + 3)
    } else {
      title = fn
    }
  }
  if (!title) title = '未知'
  if (!artist) artist = '未知'
  const duration = Number(s.Duration || s.duration || 0)
  return {
    id: `kg:${hash}`,
    externalId: hash,
    title,
    artist: cleanArtist(String(artist)),
    album: s.AlbumName || s.albumname || albumTitle || '',
    duration,
    platform: 'kg',
    cover: s.Image?.replace('{size}', '240'),
    qualitys: ['128k', '320k'],
    musicInfo: {
      name: title,
      singer: cleanArtist(String(artist)),
      albumName: s.AlbumName || s.albumname || albumTitle || '',
      hash,
      songmid: hash,
      source: 'kg',
      img: s.Image?.replace('{size}', '240'),
      interval: formatIntervalFromSec(duration),
    },
  }
}

/**
 * kg 专辑详情：mobilecdn `/api/v3/album/song` 返回 `{ data: { total, info: songs[] } }`，
 * 无独立专辑元数据；albumTitle 由调用方在搜结果中传入时可覆盖。
 */
export function mapKgAlbumDetail(
  data: any,
  albumId: string,
  meta?: { title?: string; artist?: string; cover?: string },
): AlbumDetail {
  const payload = data?.data || data
  // 旧形状兼容：info 为对象 + lists 为曲目
  const list: any[] = Array.isArray(payload?.info)
    ? payload.info
    : payload?.lists || payload?.songs || []
  const infoObj = !Array.isArray(payload?.info) && payload?.info ? payload.info : {}
  const id = String(infoObj?.albumid || infoObj?.album_id || albumId)
  const albumTitle = meta?.title || infoObj?.albumname || infoObj?.name || `专辑 ${id}`
  const artist =
    meta?.artist ||
    infoObj?.singername ||
    artistsJoin(infoObj?.authors) ||
    '未知'
  const cover =
    meta?.cover ||
    infoObj?.img?.replace?.('{size}', '240') ||
    infoObj?.sizable_cover?.replace?.('{size}', '240')
  const total = Number(payload?.total ?? infoObj?.songcount ?? list.length) || list.length
  const album: SearchAlbum = {
    id: `kg:${id}`,
    externalId: id,
    title: albumTitle,
    artist: cleanArtist(String(artist)),
    trackCount: total || undefined,
    cover,
    platform: 'kg',
    publishTime: infoObj?.publishtime ? String(infoObj.publishtime) : undefined,
  }
  const tracks = polishTracks(list.map((s: any) => mapKgAlbumSong(s, albumTitle)))
  return { album, tracks }
}

async function searchKgAlbums(keyword: string, page: number): Promise<SearchAlbum[]> {
  // complexsearch /v2/search/album 已 404；mobilecdn v3 无需签名
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/album?keyword=${encodeURIComponent(keyword)}` +
    `&page=${page}&pagesize=30&iscorrect=1&version=9108`
  const data = await fetchJson(url, { headers: { Referer: 'https://www.kugou.com/' } })
  if (data?.status === 0 || data?.errcode) {
    throw new Error(data?.error_msg || data?.error || `errcode ${data?.errcode}`)
  }
  return mapKgSearchAlbums(data?.data?.info || data?.data?.lists || [])
}

async function getKgAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const url =
    `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${encodeURIComponent(albumId)}` +
    `&page=1&pagesize=500&version=9108`
  const data = await fetchJson(url, { headers: { Referer: 'https://www.kugou.com/' } })
  const detail = mapKgAlbumDetail(data, albumId)
  if (!detail.tracks.length) throw new Error('专辑曲目为空')
  return detail
}

const albumSearchAdapters: Record<
  AlbumCapablePlatform,
  (kw: string, page: number) => Promise<SearchAlbum[]>
> = {
  wy: searchWyAlbums,
  tx: searchTxAlbums,
  kw: searchKwAlbums,
  kg: searchKgAlbums,
}

const albumDetailAdapters: Record<AlbumCapablePlatform, (albumId: string) => Promise<AlbumDetail>> = {
  wy: getWyAlbumDetail,
  tx: getTxAlbumDetail,
  kw: getKwAlbumDetail,
  kg: getKgAlbumDetail,
}

const albumSearchCache = new Map<string, { at: number; items: SearchAlbum[] }>()
const albumDetailCache = new Map<string, { at: number; detail: AlbumDetail }>()
const ALBUM_TTL_MS = 60_000

export function clearAlbumCache() {
  albumSearchCache.clear()
  albumDetailCache.clear()
}

function isAlbumCapable(platform: string): platform is AlbumCapablePlatform {
  return (ALBUM_CAPABLE_PLATFORMS as readonly string[]).includes(platform)
}

export async function searchAlbums(platform: string, keyword: string, page = 1) {
  if (!isAlbumCapable(platform)) {
    throw createError({ statusCode: 400, statusMessage: `暂不支持专辑搜索: ${platform}` })
  }
  if (!keyword.trim()) throw createError({ statusCode: 400, statusMessage: '请输入关键词' })
  const key = `album:${platform}:${keyword.trim()}:${page}`
  const hit = albumSearchCache.get(key)
  if (hit && Date.now() - hit.at < ALBUM_TTL_MS) return hit.items
  try {
    const items = await albumSearchAdapters[platform](keyword.trim(), page)
    for (const it of items) {
      it.artist = cleanArtist(it.artist)
    }
    albumSearchCache.set(key, { at: Date.now(), items })
    return items
  } catch (err: any) {
    const detail = String(err?.message || err || 'unknown')
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `专辑搜索失败(${platformLabel(platform)}): ${detail}`,
      data: { platform, reason: detail },
    })
  }
}

export async function getAlbumDetail(platform: string, albumId: string) {
  if (!isAlbumCapable(platform)) {
    throw createError({ statusCode: 400, statusMessage: `暂不支持专辑详情: ${platform}` })
  }
  const id = String(albumId || '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 albumId' })
  const key = `albumDetail:${platform}:${id}`
  const hit = albumDetailCache.get(key)
  if (hit && Date.now() - hit.at < ALBUM_TTL_MS) return hit.detail
  try {
    const detail = await albumDetailAdapters[platform](id)
    albumDetailCache.set(key, { at: Date.now(), detail })
    return detail
  } catch (err: any) {
    const detail = String(err?.message || err || 'unknown')
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `专辑详情失败(${platformLabel(platform)}): ${detail}`,
      data: { platform, albumId: id, reason: detail },
    })
  }
}
