async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'miyin/0.1',
        ...headers,
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
  // 翻译里有而原文没有的时间戳，附加在末尾
  for (const [time, texts] of tMap) {
    if (used.has(time)) continue
    for (const t of texts) out.push(`[${time}]${t}`)
  }
  return out.join('\n')
}

export async function fetchLyric(platform: string, musicInfo: Record<string, any>): Promise<string | null> {
  if (platform === 'wy') {
    const id = musicInfo.songmid || musicInfo.hash
    if (!id) return null
    const data = await fetchJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
      Referer: 'https://music.163.com/',
    })
    const orig = data?.lrc?.lyric || ''
    const trans = data?.tlyric?.lyric || data?.romalrc?.lyric || ''
    const merged = mergeBilingualLyrics(orig, trans)
    return merged || null
  }
  if (platform === 'kw') {
    const id = musicInfo.songmid || musicInfo.hash
    if (!id) return null
    const data = await fetchJson(`https://mobi.kuwo.cn/mobi.s?f=web&type=lyric&musicId=${id}`)
    if (!data?.data?.lrclist) return null
    return data.data.lrclist.map((l: any) => `[${l.time}]${l.lineLyric}`).join('\n')
  }
  return null
}
