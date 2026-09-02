import { randomUUID } from 'node:crypto'
import PQueue from 'p-queue'
import { PLAYLIST_PLATFORM_ORDER, platformLabel, platformListText } from '#shared/platforms'
import { request as httpsRequest } from 'node:https'
import { request as httpRequestPlain } from 'node:http'
import { URL } from 'node:url'
import { searchPlatform } from './platformSearch'
import { matchTrack } from './trackMatcher'
import { enqueueDownload, batchEnqueueDownload } from './downloadQueue'
import { getSettings } from './settingsService'
import { assertDownloadDirWritable } from '../utils/downloadDir'

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

/** 移动端 UA：wy PC 端 playlist/detail 常只返回少量 tracks，完整列表在 trackIds */
const WY_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CloudMusic/8.9.10'

const QQ_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://y.qq.com/',
}

/**
 * 从 wy 歌单链接提取 id。
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
 * 从 tx 歌单链接提取 disstid。
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
 * 从 kg 歌单链接提取 specialid。
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
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal })
  } finally {
    clearTimeout(t)
  }
}

/** kg CDN 证书常与域名不匹配，用 Node http(s) 且不校验证书 */
function fetchKugouJson(url: string, headers: Record<string, string>, ms = 20000, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return reject(err)
    }
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
        } as unknown as Record<string, unknown>,
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
      const onAbort = () => {
        req.destroy()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      }
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }
      req.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        reject(err)
      })
      req.on('close', () => {
        if (signal) signal.removeEventListener('abort', onAbort)
      })
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
export async function resolvePlaylistUrl(input: string, opts?: { signal?: AbortSignal }): Promise<string> {
  let current = input.trim()
  if (!/^https?:\/\//i.test(current)) return current

  for (let i = 0; i < 5; i++) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    if (extractQqPlaylistId(current) || extractNeteasePlaylistId(current)) return current

    const res = await fetchWithTimeout(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
      signal: opts?.signal,
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

async function fetchQqViaMusicu(id: string, url: string, opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void }): Promise<PlaylistDraft> {
  const pageSize = 100
  let begin = 0
  let title = `歌单 ${id}`
  const all: unknown[] = []
  let total = Infinity

  while (begin < total && begin < 5000) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
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
      signal: opts?.signal,
    })
    if (!res.ok) throw new Error(`musicu HTTP ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    const payload = (data?.req_0 as Record<string, unknown>)?.data as Record<string, unknown>
    if ((data?.req_0 as Record<string, unknown>)?.code !== 0 || payload?.code !== 0) {
      throw new Error(`musicu code ${(data?.req_0 as Record<string, unknown>)?.code}/${payload?.code}`)
    }
    const dirinfo = payload?.dirinfo as Record<string, unknown> | undefined
    title = (dirinfo?.title as string) || title
    total = Number(dirinfo?.songnum || 0) || total
    const chunk = (payload?.songlist as unknown[]) || []
    all.push(...chunk)
    if (opts?.onProgress) {
      opts.onProgress({
        index: all.length,
        total: Number.isFinite(total) ? total : all.length,
        title,
      })
    }
    if (!chunk.length || chunk.length < pageSize) break
    begin += chunk.length
  }

  const tracks = mapQqSongs(all)
  if (!tracks.length) throw new Error('musicu 无曲目')
  return { platform: 'tx', title, url, tracks }
}

async function fetchQqViaV8(id: string, url: string, opts?: { signal?: AbortSignal }): Promise<PlaylistDraft> {
  const api =
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?newsong=1&id=${encodeURIComponent(id)}` +
    `&format=json&inCharset=utf-8&outCharset=utf-8`
  const res = await fetchWithTimeout(api, { headers: QQ_HEADERS, signal: opts?.signal })
  if (!res.ok) throw new Error(`v8 HTTP ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  if (data?.code !== 0) throw new Error(`v8 code ${data?.code}`)
  const cd = (data?.data as Record<string, unknown>)?.cdlist as Array<Record<string, unknown>> | undefined
  const cd0 = cd?.[0]
  if (!cd0) throw new Error('v8 无歌单')
  const tracks = mapQqSongs((cd0.songlist as unknown[]) || [])
  if (!tracks.length) throw new Error('v8 无曲目')
  return {
    platform: 'tx',
    title: (cd0.dissname as string) || `歌单 ${id}`,
    url,
    tracks,
  }
}

async function fetchQqViaGetCdInfo(id: string, url: string, opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void }): Promise<PlaylistDraft> {
  const pageSize = 100
  let begin = 0
  let title = `歌单 ${id}`
  const all: unknown[] = []
  let total = Infinity

  while (begin < total && begin < 5000) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const api =
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0` +
      `&new_format=1&disstid=${encodeURIComponent(id)}&format=json&inCharset=utf8&outCharset=utf-8` +
      `&platform=yqq.json&needNewCode=0&song_begin=${begin}&song_num=${pageSize}`
    const res = await fetchWithTimeout(api, { headers: QQ_HEADERS, signal: opts?.signal })
    if (!res.ok) throw new Error(`getcdinfo HTTP ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    if (data?.code !== 0) throw new Error(`getcdinfo code ${data?.code}`)
    const cd = (data?.cdlist as Array<Record<string, unknown>>) || []
    const cd0 = cd[0]
    if (!cd0) throw new Error('getcdinfo 无歌单')
    title = (cd0.dissname as string) || title
    total = Number(cd0.songnum || 0) || total
    const chunk = (cd0.songlist as unknown[]) || []
    // 首次拿全量时接口可能一次返回全部
    if (begin === 0 && chunk.length >= total) {
      all.push(...chunk)
      if (opts?.onProgress) {
        opts.onProgress({
          index: all.length,
          total: Number.isFinite(total) ? total : all.length,
          title,
        })
      }
      break
    }
    all.push(...chunk)
    if (opts?.onProgress) {
      opts.onProgress({
        index: all.length,
        total: Number.isFinite(total) ? total : all.length,
        title,
      })
    }
    if (!chunk.length || chunk.length < pageSize) break
    begin += chunk.length
  }

  const tracks = mapQqSongs(all)
  if (!tracks.length) throw new Error('getcdinfo 无曲目')
  return { platform: 'tx', title, url, tracks }
}

async function parseQqPlaylist(id: string, url: string, opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void }): Promise<PlaylistDraft> {
  const errors: string[] = []
  const fetchers = [
    { name: 'musicu', fn: fetchQqViaMusicu },
    { name: 'v8', fn: fetchQqViaV8 },
    { name: 'getcdinfo', fn: fetchQqViaGetCdInfo },
  ]
  for (const { name, fn } of fetchers) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    try {
      return await fn(id, url, opts)
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'AbortError' || opts?.signal?.aborted) throw err
      errors.push(`${name}: ${e?.message || String(err)}`)
    }
  }
  throw createError({
    statusCode: 502,
    statusMessage: `${platformLabel('tx')} 歌单解析失败（已尝试多接口）：${errors.join('；')}`,
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

async function parseKugouPlaylist(id: string, url: string, opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void }): Promise<PlaylistDraft> {
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
      if (opts?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      try {
        return (await fetchKugouJson(`${host}${path}`, headers, 20000, opts?.signal)) as Record<string, unknown>
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string }
        if (e?.name === 'AbortError' || opts?.signal?.aborted) throw err
        errors.push(`${host}: ${e?.message || String(err)}`)
      }
    }
    throw new Error(errors.join('；') || `${platformLabel('kg')} 接口不可用`)
  }

  let title = `歌单 ${id}`
  try {
    const info = await getJson(`/api/v3/special/info?specialid=${encodeURIComponent(id)}`)
    const data = info?.data as Record<string, unknown> | undefined
    title = (data?.specialname as string) || title
  } catch {
    /* ignore title failure */
  }

  const pageSize = 50
  let page = 1
  let total = Infinity
  const all: unknown[] = []
  while (all.length < total && page <= 40) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const data = await getJson(
      `/api/v3/special/song?specialid=${encodeURIComponent(id)}&page=${page}&pagesize=${pageSize}&area_code=1`,
    )
    if (data?.status !== 1 && data?.errcode !== 0) {
      throw new Error(`kugou code ${data?.errcode}/${data?.status}`)
    }
    const dataObj = data?.data as Record<string, unknown> | undefined
    const chunk = (dataObj?.info as unknown[]) || []
    total = Number(dataObj?.total || 0) || total
    all.push(...chunk)
    if (opts?.onProgress) {
      opts.onProgress({
        index: all.length,
        total: Number.isFinite(total) ? total : all.length,
        title,
      })
    }
    if (!chunk.length || chunk.length < pageSize) break
    page += 1
  }

  const tracks: PlaylistTrackDraft[] = all
    .map((s: unknown) => {
      const song = (s || {}) as Record<string, unknown>
      const hash = String(song.hash || song['320hash'] || '')
      const split = splitKgFilename(String(song.filename || song.songname || ''))
      return {
        externalId: hash || undefined,
        title: split.title,
        artist: split.artist,
        album: (song.album_name as string) || '',
        duration: Number(song.duration || 0) || undefined,
        platform: 'kg',
      } satisfies PlaylistTrackDraft
    })
    .filter((t) => t.title && t.title !== '未知')

  if (!tracks.length) throw new Error(`${platformLabel('kg')} 歌单无曲目或接口失败`)
  return { platform: 'kg', title, url, tracks }
}

/**
 * 解析歌单链接：
 * - wy / tx / kg
 */
export async function parsePlaylist(
  url: string,
  opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void },
): Promise<PlaylistDraft> {
  const raw = url.trim()
  if (!raw) throw createError({ statusCode: 400, statusMessage: '请输入歌单链接' })
  if (opts?.signal?.aborted) {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    throw err
  }

  const resolved = await resolvePlaylistUrl(raw, opts)
  const haystack = `${raw}\n${resolved}`

  if (/y\.qq\.com|i\.y\.qq\.com|c\.y\.qq\.com/i.test(haystack)) {
    const qqId = extractQqPlaylistId(resolved) || extractQqPlaylistId(raw)
    if (qqId) return await parseQqPlaylist(qqId, raw, opts)
  }

  if (/kugou\.com/i.test(haystack)) {
    const kgId = extractKugouPlaylistId(resolved) || extractKugouPlaylistId(raw)
    if (kgId) return await parseKugouPlaylist(kgId, raw, opts)
  }

  if (/music\.163\.com/i.test(haystack)) {
    const wyId = extractNeteasePlaylistId(resolved) || extractNeteasePlaylistId(raw)
    if (wyId) return await parseNeteasePlaylist(wyId, raw, opts)
  }

  // 纯数字：先 wy → tx → kg
  if (/^\d{5,}$/.test(raw)) {
    try {
      return await parseNeteasePlaylist(raw, raw, opts)
    } catch (err: unknown) {
      const e = err as { name?: string }
      if (e?.name === 'AbortError' || opts?.signal?.aborted) throw err
      try {
        return await parseQqPlaylist(raw, raw, opts)
      } catch (err2: unknown) {
        const e2 = err2 as { name?: string }
        if (e2?.name === 'AbortError' || opts?.signal?.aborted) throw err2
        return await parseKugouPlaylist(raw, raw, opts)
      }
    }
  }

  const qqId = extractQqPlaylistId(resolved) || extractQqPlaylistId(raw)
  if (qqId && /qq\.com/i.test(haystack)) return await parseQqPlaylist(qqId, raw, opts)

  const kgId = extractKugouPlaylistId(resolved) || extractKugouPlaylistId(raw)
  if (kgId && /kugou\.com/i.test(haystack)) return await parseKugouPlaylist(kgId, raw, opts)

  const wyId = extractNeteasePlaylistId(resolved) || extractNeteasePlaylistId(raw)
  if (wyId) return await parseNeteasePlaylist(wyId, raw, opts)

  throw createError({
    statusCode: 400,
    statusMessage: `暂不支持该歌单链接，目前支持 ${platformListText(PLAYLIST_PLATFORM_ORDER)} 歌单链接`,
  })
}

async function parseNeteasePlaylist(
  id: string,
  url: string,
  opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void },
): Promise<PlaylistDraft> {
  // 移动端头 + n 放大；完整曲目 ID 在 trackIds，tracks 往往只有预览几首
  const api = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=100000&s=0`
  const res = await fetchWithTimeout(api, {
    headers: {
      'User-Agent': WY_MOBILE_UA,
      Referer: 'https://music.163.com/m/',
    },
    signal: opts?.signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  if (data?.code && data.code !== 200) {
    throw createError({
      statusCode: 502,
      statusMessage: `${platformLabel('wy')} 歌单接口失败(${data.code}): ${data.msg || data.message || 'unknown'}`,
    })
  }
  const pl = data?.playlist as Record<string, unknown> | undefined
  if (!pl) throw createError({ statusCode: 502, statusMessage: '歌单不存在或接口失败' })

  const previewTracks: PlaylistTrackDraft[] = ((pl.tracks as unknown[]) || []).map(mapNeteaseSong)
  const trackIds: string[] = ((pl.trackIds as unknown[]) || [])
    .map((t: unknown) => {
      const item = t as { id?: unknown } | undefined
      return String(item?.id ?? t)
    })
    .filter((x: string) => /^\d+$/.test(x))

  let tracks = previewTracks
  const title = (pl.name as string) || `歌单 ${id}`
  if (opts?.onProgress) {
    opts.onProgress({
      index: previewTracks.length,
      total: trackIds.length > previewTracks.length ? trackIds.length : previewTracks.length,
      title,
    })
  }

  // PC/Web 常见：tracks 仅几首，trackIds 才是完整列表（如「喜欢的音乐」）
  if (trackIds.length > previewTracks.length) {
    tracks = await fetchNeteaseSongsByIds(trackIds, opts)
    if (!tracks.length && previewTracks.length) tracks = previewTracks
  }

  if (!tracks.length) {
    throw createError({ statusCode: 502, statusMessage: '歌单曲目为空或无法解析' })
  }

  return {
    platform: 'wy',
    title,
    url,
    tracks,
  }
}

function mapNeteaseSong(s: any): PlaylistTrackDraft {
  const artists = s.ar || s.artists || []
  return {
    externalId: String(s.id),
    title: s.name || '未知',
    artist: artists.map((a: any) => a.name).filter(Boolean).join(' / ') || '未知',
    album: s.al?.name || s.album?.name || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
    platform: 'wy',
  }
}

/** 按 trackIds 分批拉取歌曲详情（对齐移动端补全歌单） */
async function fetchNeteaseSongsByIds(
  ids: string[],
  opts?: { signal?: AbortSignal; onProgress?: (p: { index: number; total: number; title: string }) => void },
): Promise<PlaylistTrackDraft[]> {
  const BATCH = 200
  const byId = new Map<string, PlaylistTrackDraft>()
  for (let i = 0; i < ids.length; i += BATCH) {
    if (opts?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const batch = ids.slice(i, i + BATCH)
    const c = JSON.stringify(batch.map((sid) => ({ id: Number(sid) })))
    const api = `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(c)}`
    const res = await fetchWithTimeout(api, {
      headers: {
        'User-Agent': WY_MOBILE_UA,
        Referer: 'https://music.163.com/',
      },
      signal: opts?.signal,
    })
    if (!res.ok) throw new Error(`song/detail HTTP ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    if (data?.code !== 200 || !Array.isArray(data.songs)) {
      throw new Error(String(data?.msg || data?.message || 'song/detail 失败'))
    }
    for (const s of data.songs) {
      const row = mapNeteaseSong(s)
      if (row.externalId) byId.set(row.externalId, row)
    }
    if (opts?.onProgress) {
      opts.onProgress({
        index: Math.min(i + BATCH, ids.length),
        total: ids.length,
        title: '网易云歌单',
      })
    }
  }
  // 保持歌单原有顺序
  return ids.map((sid) => byId.get(sid)).filter(Boolean) as PlaylistTrackDraft[]
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

export type PlaylistMatchOptions = {
  scoreThreshold?: number
  concurrency?: number
  signal?: AbortSignal
  allowManualBypass?: boolean
  onProgress?: (event: {
    index: number
    total: number
    track: PlaylistTrackDraft
    row: PlaylistMatchRow
  }) => void | Promise<void>
}

/** 批量匹配曲目，支持并发、进度通知与中断信号 */
export async function matchPlaylistTracks(
  tracks: PlaylistTrackDraft[],
  opts?: PlaylistMatchOptions,
): Promise<PlaylistMatchRow[]> {
  const threshold = opts?.scoreThreshold ?? CONFIRM_SCORE_THRESHOLD
  const concurrency = Math.max(1, Math.min(16, opts?.concurrency ?? 6))
  const signal = opts?.signal
  const rows: PlaylistMatchRow[] = new Array(tracks.length)
  const total = tracks.length

  const matchQueue = new PQueue({ concurrency })

  const processSingleTrack = async (track: PlaylistTrackDraft, index: number): Promise<PlaylistMatchRow> => {
    if (signal?.aborted) {
      const err = new Error('Match operation aborted')
      err.name = 'AbortError'
      throw err
    }

    try {
      if (track.musicInfo && opts?.allowManualBypass) {
        const row: PlaylistMatchRow = {
          index,
          track,
          method: (track.matchMethod as any) || 'manual',
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
        }
        rows[index] = row
        if (opts?.onProgress) {
          await opts.onProgress({ index, total, track, row })
        }
        return row
      }

      const candidates = await searchPlatform(track.platform, `${track.title} ${track.artist}`, 1, { signal })
      if (signal?.aborted) {
        const err = new Error('Match operation aborted')
        err.name = 'AbortError'
        throw err
      }

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
      const row: PlaylistMatchRow = {
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
      }
      rows[index] = row
      if (opts?.onProgress) {
        await opts.onProgress({ index, total, track, row })
      }
      return row
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'AbortError' || signal?.aborted) {
        throw err
      }
      const row: PlaylistMatchRow = {
        index,
        track,
        method: 'none',
        score: 0,
        needsConfirm: true,
        selected: null,
        candidates: [],
        error: e?.message || String(err),
      }
      rows[index] = row
      if (opts?.onProgress) {
        await opts.onProgress({ index, total, track, row })
      }
      return row
    }
  }

  const tasks = tracks.map((t, idx) => () => processSingleTrack(t, idx))

  try {
    await matchQueue.addAll(tasks, { signal })
  } catch (err: unknown) {
    const e = err as { name?: string }
    if (e?.name === 'AbortError' || signal?.aborted) {
      matchQueue.clear()
      return rows.filter((r) => Boolean(r))
    }
    throw err
  }

  return rows.filter((r) => Boolean(r))
}

export type MatchAndEnqueueOptions = {
  quality?: string
  downloadLyric?: boolean
  lyricMode?: 'external' | 'embedded'
  onlyMatched?: boolean
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (event: {
    stage: 'parsing' | 'matching' | 'enqueuing'
    index: number
    total: number
    title: string
    ok?: boolean
    error?: string
  }) => void | Promise<void>
}

export async function matchAndEnqueuePlaylist(
  draft: PlaylistDraft,
  opts?: MatchAndEnqueueOptions,
) {
  // 入队前先探测下载目录可写，避免整批「成功 0」且无明确错误
  assertDownloadDirWritable(getSettings().downloadDir)

  const signal = opts?.signal
  if (signal?.aborted) {
    const err = new Error('Operation aborted')
    err.name = 'AbortError'
    throw err
  }

  const batchId = randomUUID()
  const total = draft.tracks.length
  const results: Array<{ title: string; ok: boolean; method?: string; error?: string; taskId?: string }> = new Array(total)
  const toEnqueueList: Array<{
    title: string
    artist: string
    album?: string
    platform: string
    quality?: string
    musicInfo: Record<string, unknown>
    externalId?: string
    matchMethod?: string
    downloadLyric?: boolean
    lyricMode?: 'external' | 'embedded'
    batchId?: string
    playlistUrl?: string
    resultIndex: number
  }> = []

  const concurrency = Math.max(1, Math.min(16, opts?.concurrency ?? 6))
  const queue = new PQueue({ concurrency })
  let finishedCount = 0

  const processTrack = async (track: PlaylistTrackDraft, index: number) => {
    if (signal?.aborted) {
      const err = new Error('Operation aborted')
      err.name = 'AbortError'
      throw err
    }
    try {
      if (track.musicInfo) {
        results[index] = { title: track.title, ok: true, method: track.matchMethod || 'manual' }
        toEnqueueList.push({
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
          resultIndex: index,
        })
        finishedCount++
        if (opts?.onProgress) {
          await opts.onProgress({
            stage: 'matching',
            index: finishedCount,
            total,
            title: track.title,
            ok: true,
          })
        }
        return
      }

      const candidates = await searchPlatform(track.platform, `${track.title} ${track.artist}`, 1, { signal })
      if (signal?.aborted) {
        const err = new Error('Operation aborted')
        err.name = 'AbortError'
        throw err
      }

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
        results[index] = { title: track.title, ok: false, error: '未匹配到可下载条目' }
        finishedCount++
        if (opts?.onProgress) {
          await opts.onProgress({
            stage: 'matching',
            index: finishedCount,
            total,
            title: track.title,
            ok: false,
            error: '未匹配到可下载条目',
          })
        }
        return
      }

      const cand = matched.selected
      results[index] = { title: track.title, ok: true, method: matched.method }
      toEnqueueList.push({
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
        resultIndex: index,
      })
      finishedCount++
      if (opts?.onProgress) {
        await opts.onProgress({
          stage: 'matching',
          index: finishedCount,
          total,
          title: track.title,
          ok: true,
        })
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'AbortError' || signal?.aborted) {
        throw err
      }
      results[index] = { title: track.title, ok: false, error: e?.message || String(err) }
      finishedCount++
      if (opts?.onProgress) {
        await opts.onProgress({
          stage: 'matching',
          index: finishedCount,
          total,
          title: track.title,
          ok: false,
          error: e?.message || String(err),
        })
      }
    }
  }

  const tasks = draft.tracks.map((t, idx) => () => processTrack(t, idx))
  try {
    await queue.addAll(tasks, { signal })
  } catch (err: unknown) {
    const e = err as { name?: string }
    if (e?.name === 'AbortError' || signal?.aborted) {
      queue.clear()
      throw err
    }
    throw err
  }

  // 使用高性能分批事务批量入库，并静默单条 emitTask 以消除瞬时广播与 WAL 压力
  if (toEnqueueList.length > 0) {
    const { ids } = batchEnqueueDownload(toEnqueueList, { silent: true })
    for (let j = 0; j < toEnqueueList.length; j++) {
      const item = toEnqueueList[j]!
      const res = results[item.resultIndex]
      if (res && ids[j]) {
        res.taskId = ids[j]
      }
    }
  }

  const finalResults = results.filter(Boolean)
  return {
    batchId,
    playlistTitle: draft.title,
    total: draft.tracks.length,
    enqueued: finalResults.filter((r) => r.ok).length,
    results: finalResults,
  }
}
