import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { request as httpRequestPlain } from 'node:http'
import { URL } from 'node:url'
import { searchPlatform } from './platformSearch'
import { matchTrack } from './trackMatcher'
import { enqueueDownload } from './downloadQueue'

export type PlaylistTrackDraft = {
  externalId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  platform: string
  /** 人工确认后可直接带入，跳过搜索匹配 */
  musicInfo?: Record<string, any>
  matchMethod?: string
}

export type PlaylistDraft = {
  platform: string
  title: string
  url: string
  tracks: PlaylistTrackDraft[]
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const QQ_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://y.qq.com/',
}

/**
 * 从网易云歌单链接提取 id。
 * 支持：playlist?id= / #/playlist?id= / playlist/数字 / 纯数字 id
 */
export function extractNeteasePlaylistId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d{5,}$/.test(s)) return s

  const fromPath = s.match(/music\.163\.com\/(?:#\/)?(?:my\/)?(?:m\/)?playlist(?:\/|\?id=)(\d+)/i)
  if (fromPath?.[1]) return fromPath[1]

  if (/music\.163\.com/i.test(s)) {
    const fromQuery = s.match(/[?&#]id=(\d+)/i)
    if (fromQuery?.[1]) return fromQuery[1]
  }

  const legacy = s.match(/playlist\?id=(\d+)/i)
  if (legacy?.[1] && !/y\.qq\.com|qq\.com/i.test(s)) return legacy[1]

  return null
}

/**
 * 从 QQ 音乐歌单链接提取 disstid。
 * 覆盖网页 / 移动分享 / 旧版 playsquare / query 参数等多种形态。
 */
export function extractQqPlaylistId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const looksQq = /y\.qq\.com/i.test(s)

  // /playlist/123 /playsquare/123 /playlist/123.html
  const path = s.match(/y\.qq\.com\/(?:n\/(?:ryqq(?:_v2)?|yqq|m)\/)?(?:playlist|playsquare)\/(\d+)/i)
  if (path?.[1]) return path[1]

  // 分享页 taoge.html?id=
  const taoge = s.match(/taoge\.html[^#\s]*[?&]id=(\d+)/i)
  if (taoge?.[1]) return taoge[1]

  // query: id= / disstid=
  if (looksQq) {
    const q = s.match(/[?&#](?:id|disstid)=(\d{5,})/i)
    if (q?.[1]) return q[1]
  }

  // 纯数字：由调用方决定是否当作 QQ id
  if (/^\d{6,}$/.test(s)) return s

  return null
}

/**
 * 从酷狗歌单链接提取 specialid。
 * 支持：special/single/ID、m.kugou.com/plist/list/ID、specialid=、global_collection_id 中的数字段。
 */
export function extractKugouPlaylistId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const path =
    s.match(/kugou\.com\/yy\/special\/single\/(\d+)/i) ||
    s.match(/m\.kugou\.com\/plist\/list\/(\d+)/i) ||
    s.match(/kugou\.com\/songlist\/(\d+)/i) ||
    s.match(/\/special\/(\d+)\.html/i)
  if (path?.[1]) return path[1]

  const q = s.match(/[?&#](?:specialid|special_id|listid|id)=(\d{4,})/i)
  if (q?.[1] && /kugou\.com/i.test(s)) return q[1]

  // global_collection_id=collection_3_520033053_218_0 → 仍优先 specialid；若仅有 collection 数字串则取末段不可靠，跳过
  if (/^\d{4,}$/.test(s)) return s

  return null
}

function joinArtists(list: any): string {
  if (!list) return '未知'
  if (typeof list === 'string') return list.trim() || '未知'
  if (Array.isArray(list)) {
    return list.map((a) => a?.name || a?.title || a).filter(Boolean).join(' / ') || '未知'
  }
  return String(list)
}

function albumName(song: any): string {
  const al = song?.album
  if (al && typeof al === 'object') return al.name || al.title || ''
  return song?.albumname || song?.albumName || ''
}

function songTitle(song: any): string {
  return song?.name || song?.songname || song?.title || '未知'
}

function songMid(song: any): string {
  return String(song?.mid || song?.songmid || song?.song_mid || '')
}

function mapQqSongs(songs: any[]): PlaylistTrackDraft[] {
  return (songs || [])
    .map((s: any) => {
      const mid = songMid(s)
      return {
        externalId: mid || undefined,
        title: songTitle(s),
        artist: joinArtists(s.singer),
        album: albumName(s),
        duration: Number(s.interval || 0) || undefined,
        platform: 'tx',
      } satisfies PlaylistTrackDraft
    })
    .filter((t) => t.title && t.title !== '未知')
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 20000): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

/** 酷狗 CDN 证书常与域名不匹配，用 Node http(s) 且不校验证书 */
function fetchKugouJson(url: string, headers: Record<string, string>, ms = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      const lib = u.protocol === 'http:' ? httpRequestPlain : httpsRequest
      const req = lib(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'http:' ? 80 : 443),
          path: `${u.pathname}${u.search}`,
          method: 'GET',
          headers,
          timeout: ms,
          rejectUnauthorized: false,
        } as any,
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            if ((res.statusCode || 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            try {
              resolve(JSON.parse(raw))
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
      req.end()
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 跟随短链 / 302，尽量得到可提取 id 的最终 URL。
 * 也会从 HTML 中兜底抓取 playlist id。
 */
export async function resolvePlaylistUrl(input: string): Promise<string> {
  let current = input.trim()
  if (!/^https?:\/\//i.test(current)) return current

  for (let i = 0; i < 5; i++) {
    if (extractQqPlaylistId(current) || extractNeteasePlaylistId(current)) return current

    const res = await fetchWithTimeout(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      current = new URL(loc, current).href
      continue
    }

    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text/html') || ct.includes('text/plain')) {
      const html = await res.text()
      const qqId =
        html.match(/y\.qq\.com\/[^"'\\\s]*playlist\/(\d+)/i)?.[1] ||
        html.match(/disstid["'\s:=]+(\d{6,})/i)?.[1] ||
        html.match(/taoge\.html[^"'\\\s]*[?&]id=(\d+)/i)?.[1]
      if (qqId) return `https://y.qq.com/n/ryqq/playlist/${qqId}`

      const kgId =
        html.match(/kugou\.com\/yy\/special\/single\/(\d+)/i)?.[1] ||
        html.match(/m\.kugou\.com\/plist\/list\/(\d+)/i)?.[1] ||
        html.match(/specialid["'\s:=]+(\d{4,})/i)?.[1]
      if (kgId) return `https://www.kugou.com/yy/special/single/${kgId}.html`

      const wy =
        html.match(/https?:\/\/[^"'\\\s]*music\.163\.com[^"'\\\s]*playlist[^"'\\\s]*/i)?.[0] ||
        html.match(/music\.163\.com\/(?:#\/)?playlist\?id=(\d+)/i)?.[0]
      if (wy) {
        if (wy.startsWith('http')) return wy
        const id = wy.match(/(\d{5,})/)?.[1]
        if (id) return `https://music.163.com/playlist?id=${id}`
      }
    }
    break
  }
  return current
}

async function fetchQqViaMusicu(id: string, url: string): Promise<PlaylistDraft> {
  const pageSize = 100
  let begin = 0
  let title = `歌单 ${id}`
  const all: any[] = []
  let total = Infinity

  while (begin < total && begin < 5000) {
    const body = {
      comm: { ct: 24, cv: 0 },
      req_0: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: {
          disstid: Number(id),
          userinfo: 1,
          tag: 1,
          song_begin: begin,
          song_num: pageSize,
        },
      },
    }
    const res = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`musicu HTTP ${res.status}`)
    const data = await res.json()
    const payload = data?.req_0?.data
    if (data?.req_0?.code !== 0 || payload?.code !== 0) {
      throw new Error(`musicu code ${data?.req_0?.code}/${payload?.code}`)
    }
    title = payload?.dirinfo?.title || title
    total = Number(payload?.dirinfo?.songnum || 0) || total
    const chunk = payload?.songlist || []
    all.push(...chunk)
    if (!chunk.length || chunk.length < pageSize) break
    begin += chunk.length
  }

  const tracks = mapQqSongs(all)
  if (!tracks.length) throw new Error('musicu 无曲目')
  return { platform: 'tx', title, url, tracks }
}

async function fetchQqViaV8(id: string, url: string): Promise<PlaylistDraft> {
  const api =
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?newsong=1&id=${encodeURIComponent(id)}` +
    `&format=json&inCharset=utf-8&outCharset=utf-8`
  const res = await fetchWithTimeout(api, { headers: QQ_HEADERS })
  if (!res.ok) throw new Error(`v8 HTTP ${res.status}`)
  const data = await res.json()
  if (data?.code !== 0) throw new Error(`v8 code ${data?.code}`)
  const cd = data?.data?.cdlist?.[0]
  if (!cd) throw new Error('v8 无歌单')
  const tracks = mapQqSongs(cd.songlist || [])
  if (!tracks.length) throw new Error('v8 无曲目')
  return {
    platform: 'tx',
    title: cd.dissname || `歌单 ${id}`,
    url,
    tracks,
  }
}

async function fetchQqViaGetCdInfo(id: string, url: string): Promise<PlaylistDraft> {
  const pageSize = 100
  let begin = 0
  let title = `歌单 ${id}`
  const all: any[] = []
  let total = Infinity

  while (begin < total && begin < 5000) {
    const api =
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0` +
      `&new_format=1&disstid=${encodeURIComponent(id)}&format=json&inCharset=utf8&outCharset=utf-8` +
      `&platform=yqq.json&needNewCode=0&song_begin=${begin}&song_num=${pageSize}`
    const res = await fetchWithTimeout(api, { headers: QQ_HEADERS })
    if (!res.ok) throw new Error(`getcdinfo HTTP ${res.status}`)
    const data = await res.json()
    if (data?.code !== 0) throw new Error(`getcdinfo code ${data?.code}`)
    const cd = data?.cdlist?.[0]
    if (!cd) throw new Error('getcdinfo 无歌单')
    title = cd.dissname || title
    total = Number(cd.songnum || 0) || total
    const chunk = cd.songlist || []
    // 首次拿全量时接口可能一次返回全部
    if (begin === 0 && chunk.length >= total) {
      all.push(...chunk)
      break
    }
    all.push(...chunk)
    if (!chunk.length || chunk.length < pageSize) break
    begin += chunk.length
  }

  const tracks = mapQqSongs(all)
  if (!tracks.length) throw new Error('getcdinfo 无曲目')
  return { platform: 'tx', title, url, tracks }
}

async function parseQqPlaylist(id: string, url: string): Promise<PlaylistDraft> {
  const errors: string[] = []
  const fetchers = [
    { name: 'musicu', fn: fetchQqViaMusicu },
    { name: 'v8', fn: fetchQqViaV8 },
    { name: 'getcdinfo', fn: fetchQqViaGetCdInfo },
  ]
  for (const { name, fn } of fetchers) {
    try {
      return await fn(id, url)
    } catch (err: any) {
      errors.push(`${name}: ${err?.message || err}`)
    }
  }
  throw createError({
    statusCode: 502,
    statusMessage: `QQ 歌单解析失败（已尝试多接口）：${errors.join('；')}`,
  })
}

function splitKgFilename(filename: string): { artist: string; title: string } {
  const raw = String(filename || '').trim()
  const idx = raw.indexOf(' - ')
  if (idx > 0) {
    return { artist: raw.slice(0, idx).trim() || '未知', title: raw.slice(idx + 3).trim() || '未知' }
  }
  return { artist: '未知', title: raw || '未知' }
}

async function parseKugouPlaylist(id: string, url: string): Promise<PlaylistDraft> {
  const headers = { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }
  // CDN 证书常与域名不匹配，优先 http；多域名回退
  const hosts = [
    'http://mobilecdnbj.kugou.com',
    'http://mobilecdn.kugou.com',
    'https://gateway.kugou.com',
  ]

  async function getJson(path: string) {
    const errors: string[] = []
    for (const host of hosts) {
      try {
        return await fetchKugouJson(`${host}${path}`, headers)
      } catch (err: any) {
        errors.push(`${host}: ${err?.message || err}`)
      }
    }
    throw new Error(errors.join('；') || '酷狗接口不可用')
  }

  let title = `歌单 ${id}`
  try {
    const info = await getJson(`/api/v3/special/info?specialid=${encodeURIComponent(id)}`)
    title = info?.data?.specialname || title
  } catch {
    /* ignore title failure */
  }

  const pageSize = 50
  let page = 1
  let total = Infinity
  const all: any[] = []
  while (all.length < total && page <= 40) {
    const data = await getJson(
      `/api/v3/special/song?specialid=${encodeURIComponent(id)}&page=${page}&pagesize=${pageSize}&area_code=1`,
    )
    if (data?.status !== 1 && data?.errcode !== 0) {
      throw new Error(`kugou code ${data?.errcode}/${data?.status}`)
    }
    const chunk = data?.data?.info || []
    total = Number(data?.data?.total || 0) || total
    all.push(...chunk)
    if (!chunk.length || chunk.length < pageSize) break
    page += 1
  }

  const tracks: PlaylistTrackDraft[] = all
    .map((s: any) => {
      const hash = String(s.hash || s['320hash'] || '')
      const split = splitKgFilename(s.filename || s.songname || '')
      return {
        externalId: hash || undefined,
        title: split.title,
        artist: split.artist,
        album: s.album_name || '',
        duration: Number(s.duration || 0) || undefined,
        platform: 'kg',
      } satisfies PlaylistTrackDraft
    })
    .filter((t) => t.title && t.title !== '未知')

  if (!tracks.length) throw new Error('酷狗歌单无曲目或接口失败')
  return { platform: 'kg', title, url, tracks }
}

/**
 * 解析歌单链接：
 * - 网易云 / QQ / 酷狗
 */
export async function parsePlaylist(url: string): Promise<PlaylistDraft> {
  const raw = url.trim()
  if (!raw) throw createError({ statusCode: 400, statusMessage: '请输入歌单链接' })

  const resolved = await resolvePlaylistUrl(raw)
  const haystack = `${raw}\n${resolved}`

  if (/y\.qq\.com|i\.y\.qq\.com|c\.y\.qq\.com/i.test(haystack)) {
    const qqId = extractQqPlaylistId(resolved) || extractQqPlaylistId(raw)
    if (qqId) return await parseQqPlaylist(qqId, raw)
  }

  if (/kugou\.com/i.test(haystack)) {
    const kgId = extractKugouPlaylistId(resolved) || extractKugouPlaylistId(raw)
    if (kgId) return await parseKugouPlaylist(kgId, raw)
  }

  if (/music\.163\.com/i.test(haystack)) {
    const wyId = extractNeteasePlaylistId(resolved) || extractNeteasePlaylistId(raw)
    if (wyId) return await parseNeteasePlaylist(wyId, raw)
  }

  // 纯数字：先网易 → QQ → 酷狗
  if (/^\d{5,}$/.test(raw)) {
    try {
      return await parseNeteasePlaylist(raw, raw)
    } catch {
      try {
        return await parseQqPlaylist(raw, raw)
      } catch {
        return await parseKugouPlaylist(raw, raw)
      }
    }
  }

  const qqId = extractQqPlaylistId(resolved) || extractQqPlaylistId(raw)
  if (qqId && /qq\.com/i.test(haystack)) return await parseQqPlaylist(qqId, raw)

  const kgId = extractKugouPlaylistId(resolved) || extractKugouPlaylistId(raw)
  if (kgId && /kugou\.com/i.test(haystack)) return await parseKugouPlaylist(kgId, raw)

  const wyId = extractNeteasePlaylistId(resolved) || extractNeteasePlaylistId(raw)
  if (wyId) return await parseNeteasePlaylist(wyId, raw)

  throw createError({
    statusCode: 400,
    statusMessage: '暂不支持该歌单链接，目前支持网易云 / QQ / 酷狗 playlist 链接',
  })
}

async function parseNeteasePlaylist(id: string, url: string): Promise<PlaylistDraft> {
  const api = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000`
  const res = await fetchWithTimeout(api, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const pl = data?.playlist
  if (!pl) throw createError({ statusCode: 502, statusMessage: '歌单不存在或接口失败' })
  const tracks: PlaylistTrackDraft[] = (pl.tracks || []).map((s: any) => ({
    externalId: String(s.id),
    title: s.name || '未知',
    artist: (s.ar || []).map((a: any) => a.name).filter(Boolean).join(' / ') || '未知',
    album: s.al?.name || '',
    duration: Math.round((s.dt || 0) / 1000),
    platform: 'wy',
  }))
  return {
    platform: 'wy',
    title: pl.name || `歌单 ${id}`,
    url,
    tracks,
  }
}

export type PlaylistMatchRow = {
  index: number
  track: PlaylistTrackDraft
  method: 'id' | 'metadata' | 'manual' | 'none'
  score: number
  needsConfirm: boolean
  selected: {
    externalId?: string
    title: string
    artist: string
    album?: string
    duration?: number
    musicInfo?: Record<string, any>
  } | null
  candidates: Array<{
    externalId?: string
    title: string
    artist: string
    album?: string
    duration?: number
    score: number
    musicInfo?: Record<string, any>
  }>
  error?: string
}

const CONFIRM_SCORE_THRESHOLD = 0.7

/** 批量匹配曲目，低分/无命中标记 needsConfirm 供前端人工确认 */
export async function matchPlaylistTracks(
  tracks: PlaylistTrackDraft[],
  opts?: { scoreThreshold?: number },
): Promise<PlaylistMatchRow[]> {
  const threshold = opts?.scoreThreshold ?? CONFIRM_SCORE_THRESHOLD
  const rows: PlaylistMatchRow[] = []

  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index]!
    try {
      if (track.musicInfo) {
        rows.push({
          index,
          track,
          method: 'manual',
          score: 1,
          needsConfirm: false,
          selected: {
            externalId: track.externalId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            musicInfo: track.musicInfo,
          },
          candidates: [],
        })
        continue
      }

      const candidates = await searchPlatform(track.platform, `${track.title} ${track.artist}`, 1)
      const mapped = candidates.map((c) => ({
        externalId: c.externalId,
        title: c.title,
        artist: c.artist,
        album: c.album,
        duration: c.duration,
        musicInfo: c.musicInfo,
      }))
      const matched = matchTrack(
        {
          externalId: track.externalId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          platform: track.platform,
        },
        { candidatesFromSearch: mapped },
      )

      const needsConfirm = !matched.selected || matched.score < threshold
      rows.push({
        index,
        track,
        method: matched.selected ? matched.method : 'none',
        score: matched.score,
        needsConfirm,
        selected: matched.selected
          ? {
              externalId: matched.selected.externalId,
              title: matched.selected.title,
              artist: matched.selected.artist,
              album: matched.selected.album,
              duration: matched.selected.duration,
              musicInfo: matched.selected.musicInfo,
            }
          : null,
        candidates: matched.candidates.slice(0, 8).map((c) => ({
          externalId: c.externalId,
          title: c.title,
          artist: c.artist,
          album: c.album,
          duration: c.duration,
          score: c.score,
          musicInfo: c.musicInfo,
        })),
      })
    } catch (err: any) {
      rows.push({
        index,
        track,
        method: 'none',
        score: 0,
        needsConfirm: true,
        selected: null,
        candidates: [],
        error: err?.message || String(err),
      })
    }
  }

  return rows
}

export async function matchAndEnqueuePlaylist(
  draft: PlaylistDraft,
  opts?: { quality?: string; downloadLyric?: boolean; lyricMode?: 'external' | 'embedded'; onlyMatched?: boolean },
) {
  const batchId = randomUUID()
  const results: Array<{ title: string; ok: boolean; method?: string; error?: string; taskId?: string }> = []

  for (const track of draft.tracks) {
    try {
      // 已人工确认 / 预解析
      if (track.musicInfo) {
        const task = enqueueDownload({
          title: track.title,
          artist: track.artist,
          album: track.album,
          platform: track.platform,
          quality: opts?.quality,
          musicInfo: track.musicInfo,
          externalId: track.externalId,
          matchMethod: track.matchMethod || 'manual',
          downloadLyric: opts?.downloadLyric,
          lyricMode: opts?.lyricMode,
          batchId,
          playlistUrl: draft.url,
        })
        results.push({ title: track.title, ok: true, method: track.matchMethod || 'manual', taskId: task.id })
        continue
      }

      const candidates = await searchPlatform(track.platform, `${track.title} ${track.artist}`, 1)
      const matched = matchTrack(
        {
          externalId: track.externalId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          platform: track.platform,
        },
        {
          candidatesFromSearch: candidates.map((c) => ({
            externalId: c.externalId,
            title: c.title,
            artist: c.artist,
            album: c.album,
            duration: c.duration,
            musicInfo: c.musicInfo,
          })),
        },
      )

      if (!matched.selected) {
        results.push({ title: track.title, ok: false, error: '未匹配到可下载条目' })
        continue
      }

      const cand = matched.selected
      const task = enqueueDownload({
        title: cand.title,
        artist: cand.artist,
        album: cand.album,
        platform: track.platform,
        quality: opts?.quality,
        musicInfo: cand.musicInfo || {
          name: cand.title,
          singer: cand.artist,
          songmid: cand.externalId,
          hash: cand.externalId,
          source: track.platform,
        },
        externalId: cand.externalId,
        matchMethod: matched.method,
        downloadLyric: opts?.downloadLyric,
        lyricMode: opts?.lyricMode,
        batchId,
        playlistUrl: draft.url,
      })
      results.push({ title: track.title, ok: true, method: matched.method, taskId: task.id })
    } catch (err: any) {
      results.push({ title: track.title, ok: false, error: err?.message || String(err) })
    }
  }

  return {
    batchId,
    playlistTitle: draft.title,
    total: draft.tracks.length,
    enqueued: results.filter((r) => r.ok).length,
    results,
  }
}
