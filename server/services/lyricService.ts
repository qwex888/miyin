import { decodeKrcBase64 } from '../utils/krcDecode'
import { decryptTxFieldToLrc } from '../utils/txQrc'

async function fetchText(
  url: string,
  opts?: { headers?: Record<string, string>; method?: string; body?: string },
): Promise<string | null> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: opts?.method || 'GET',
      body: opts?.body,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...opts?.headers,
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}, init?: RequestInit) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...init,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers,
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function b64Utf8(s: string): string {
  try {
    return decodeHtmlEntities(Buffer.from(s, 'base64').toString('utf8'))
  } catch {
    return ''
  }
}

function formatKuwoTime(time: string | number): string {
  const n = typeof time === 'number' ? time : parseFloat(String(time))
  if (!Number.isFinite(n)) return String(time)
  // mobi / h5 有时给秒（带小数），有时已是 mm:ss.xx
  if (typeof time === 'string' && time.includes(':')) return time
  const m = Math.floor(n / 60)
  const s = n - m * 60
  const sec = Math.floor(s)
  const frac = Math.round((s - sec) * 100)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(frac).padStart(2, '0')}`
}

/** 解析 LRC 为 时间戳 -> 文本（同时间多行保留） */
export function parseLrcLines(lrc: string): Array<{ time: string; text: string }> {
  const out: Array<{ time: string; text: string }> = []
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.*)$/)
    if (!m) {
      out.push({ time: '', text: line })
      continue
    }
    out.push({ time: m[1]!, text: (m[2] || '').trim() })
  }
  return out
}

/**
 * 合并原文 + 翻译/罗马音：
 * 同一时间戳输出两行（先原文后翻译），便于播放器双语显示。
 */
export function mergeBilingualLyrics(original: string, translated?: string | null): string {
  const orig = String(original || '').trim()
  const trans = String(translated || '').trim()
  if (!orig) return trans || ''
  if (!trans) return orig

  const oLines = parseLrcLines(orig)
  const tMap = new Map<string, string[]>()
  for (const l of parseLrcLines(trans)) {
    if (!l.time || !l.text) continue
    const arr = tMap.get(l.time) || []
    arr.push(l.text)
    tMap.set(l.time, arr)
  }

  const used = new Set<string>()
  const out: string[] = []
  for (const l of oLines) {
    if (!l.time) {
      out.push(l.text)
      continue
    }
    out.push(`[${l.time}]${l.text}`)
    const trs = tMap.get(l.time)
    if (trs?.length) {
      used.add(l.time)
      for (const t of trs) {
        if (t && t !== l.text) out.push(`[${l.time}]${t}`)
      }
    }
  }
  for (const [time, texts] of tMap) {
    if (used.has(time)) continue
    for (const t of texts) out.push(`[${time}]${t}`)
  }
  return out.join('\n')
}

/**
 * kw h5：同一时间戳第二次出现视为翻译（先原文后翻译）。
 */
export function splitKuwoLrcList(
  lrclist: Array<{ time?: string | number; lineLyric?: string }>,
): { lyric: string; tlyric: string } {
  const lrc: Array<{ time: string; text: string }> = []
  const lrcT: Array<{ time: string; text: string }> = []
  const seen = new Set<string>()
  for (const item of lrclist || []) {
    const time = formatKuwoTime(item.time ?? '')
    const text = String(item.lineLyric || '').trim()
    if (!time) continue
    if (seen.has(time)) {
      lrcT.push({ time, text })
    } else {
      lrc.push({ time, text })
      seen.add(time)
    }
  }
  return {
    lyric: lrc.map((l) => `[${l.time}]${l.text}`).join('\n'),
    tlyric: lrcT.map((l) => `[${l.time}]${l.text}`).join('\n'),
  }
}

function intervalToMs(musicInfo: Record<string, any>): number {
  const raw = musicInfo.interval || musicInfo.duration || musicInfo.time
  if (typeof raw === 'number' && raw > 0) {
    return raw > 10000 ? Math.round(raw) : Math.round(raw * 1000)
  }
  const s = String(raw || '')
  const m = s.match(/^(\d+):(\d+)$/)
  if (m) return (parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)) * 1000
  const n = Number(s)
  if (Number.isFinite(n) && n > 0) return n > 10000 ? Math.round(n) : Math.round(n * 1000)
  return 0
}

async function fetchWy(musicInfo: Record<string, any>): Promise<string | null> {
  const id = musicInfo.songmid || musicInfo.hash || musicInfo.id
  if (!id) return null
  const data = await fetchJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
    Referer: 'https://music.163.com/',
  })
  const orig = data?.lrc?.lyric || ''
  const trans = data?.tlyric?.lyric || data?.romalrc?.lyric || ''
  const merged = mergeBilingualLyrics(orig, trans)
  return merged || null
}

async function fetchKw(musicInfo: Record<string, any>): Promise<string | null> {
  const id = musicInfo.songmid || musicInfo.hash || musicInfo.rid
  if (!id) return null

  const h5 = await fetchJson(
    `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(String(id))}`,
    { Referer: 'https://m.kuwo.cn/' },
  )
  const list = h5?.data?.lrclist
  if (Array.isArray(list) && list.length) {
    const { lyric, tlyric } = splitKuwoLrcList(list)
    const merged = mergeBilingualLyrics(lyric, tlyric)
    if (merged) return merged
  }

  const data = await fetchJson(`https://mobi.kuwo.cn/mobi.s?f=web&type=lyric&musicId=${id}`)
  if (!data?.data?.lrclist) return null
  return data.data.lrclist
    .map((l: any) => `[${formatKuwoTime(l.time)}]${l.lineLyric || ''}`)
    .join('\n')
}

async function resolveTxSongId(musicInfo: Record<string, any>): Promise<number | null> {
  const direct = Number(musicInfo.songid || musicInfo.songId || musicInfo.id)
  if (Number.isFinite(direct) && direct > 0) return direct
  const mid = String(musicInfo.songmid || musicInfo.hash || '')
  if (!mid) return null
  const body = {
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_type: 0, song_mid: mid },
    },
  }
  const data = await fetchJson(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    { Referer: 'https://y.qq.com/', 'Content-Type': 'application/json' },
    { method: 'POST', body: JSON.stringify(body) },
  )
  const id = Number(data?.req?.data?.track_info?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

/** tx 旧接口：Base64 LRC + trans（优先） */
async function fetchTxLegacy(musicInfo: Record<string, any>): Promise<string | null> {
  const mid = String(musicInfo.songmid || musicInfo.hash || '')
  if (!mid) return null
  const url =
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}` +
    `&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  const data = await fetchJson(url, { Referer: 'https://y.qq.com/portal/player.html' })
  if (!data || (data.code !== 0 && data.retcode !== 0) || !data.lyric) return null
  const lyric = b64Utf8(data.lyric)
  const trans = data.trans ? b64Utf8(data.trans) : ''
  const merged = mergeBilingualLyrics(lyric, trans)
  return merged || null
}

/** tx 新接口 + QRC 解密兜底 */
async function fetchTxQrc(musicInfo: Record<string, any>): Promise<string | null> {
  const songId = await resolveTxSongId(musicInfo)
  if (!songId) return null
  const body = {
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: {
      method: 'GetPlayLyricInfo',
      module: 'music.musichallSong.PlayLyricInfo',
      param: {
        format: 'json',
        crypt: 1,
        ct: 19,
        cv: 1873,
        interval: 0,
        lrc_t: 0,
        qrc: 1,
        qrc_t: 0,
        roma: 1,
        roma_t: 0,
        songID: songId,
        trans: 1,
        trans_t: 0,
        type: -1,
      },
    },
  }
  const data = await fetchJson(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    { Referer: 'https://y.qq.com/', 'Content-Type': 'application/json' },
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!data || data.code !== 0 || data.req?.code !== 0) return null
  const payload = data.req?.data || {}
  const lyric = decryptTxFieldToLrc(payload.lyric)
  const trans = decryptTxFieldToLrc(payload.trans) || decryptTxFieldToLrc(payload.roma)
  const merged = mergeBilingualLyrics(lyric, trans)
  return merged || null
}

async function fetchTx(musicInfo: Record<string, any>): Promise<string | null> {
  return (await fetchTxLegacy(musicInfo)) || (await fetchTxQrc(musicInfo))
}

async function fetchKg(musicInfo: Record<string, any>): Promise<string | null> {
  const hash = String(musicInfo.hash || musicInfo.songmid || '')
  const name = String(musicInfo.name || musicInfo.songname || musicInfo.title || '')
  if (!hash && !name) return null
  const timeMs = intervalToMs(musicInfo)
  const searchUrl =
    `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc` +
    `&keyword=${encodeURIComponent(name || hash)}&hash=${encodeURIComponent(hash)}` +
    `&timelength=${timeMs || 0}&lrctxt=1`
  const headers = {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
  }
  const searched = await fetchJson(searchUrl, headers)
  const cand = searched?.candidates?.[0]
  if (!cand?.id || !cand?.accesskey) return null
  const fmt = cand.krctype == 1 && cand.contenttype != 1 ? 'krc' : 'lrc'
  const dlUrl =
    `http://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}` +
    `&accesskey=${cand.accesskey}&fmt=${fmt}&charset=utf8`
  const dl = await fetchJson(dlUrl, headers)
  if (!dl?.content) return null
  if (dl.fmt === 'krc' || fmt === 'krc') {
    const { lyric, tlyric, rlyric } = decodeKrcBase64(dl.content)
    return mergeBilingualLyrics(lyric, tlyric || rlyric) || null
  }
  try {
    const lyric = Buffer.from(dl.content, 'base64').toString('utf8')
    return lyric.trim() || null
  } catch {
    return null
  }
}

async function fetchMg(musicInfo: Record<string, any>): Promise<string | null> {
  const lrcUrl = musicInfo.lrcUrl || musicInfo.lrc_url
  const trcUrl = musicInfo.trcUrl || musicInfo.trc_url
  const mrcUrl = musicInfo.mrcUrl || musicInfo.mrc_url
  let lyric = ''
  if (lrcUrl) {
    lyric = (await fetchText(String(lrcUrl), { headers: { Referer: 'https://music.migu.cn/' } })) || ''
  } else if (mrcUrl) {
    // mg MRC 需专用解密；无密钥时跳过，避免写入乱码
    lyric = ''
  }
  const trans = trcUrl
    ? (await fetchText(String(trcUrl), { headers: { Referer: 'https://music.migu.cn/' } })) || ''
    : ''
  const merged = mergeBilingualLyrics(lyric, trans)
  return merged || null
}

export async function fetchLyric(platform: string, musicInfo: Record<string, any>): Promise<string | null> {
  try {
    if (platform === 'wy') return await fetchWy(musicInfo)
    if (platform === 'kw') return await fetchKw(musicInfo)
    if (platform === 'tx') return await fetchTx(musicInfo)
    if (platform === 'kg') return await fetchKg(musicInfo)
    if (platform === 'mg') return await fetchMg(musicInfo)
  } catch {
    return null
  }
  return null
}
