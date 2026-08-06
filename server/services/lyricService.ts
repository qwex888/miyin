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

export async function fetchLyric(platform: string, musicInfo: Record<string, any>): Promise<string | null> {
  if (platform === 'wy') {
    const id = musicInfo.songmid || musicInfo.hash
    if (!id) return null
    const data = await fetchJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
      Referer: 'https://music.163.com/',
    })
    return data?.lrc?.lyric || null
  }
  if (platform === 'kw') {
    const id = musicInfo.songmid || musicInfo.hash
    if (!id) return null
    const data = await fetchJson(`https://mobi.kuwo.cn/mobi.s?f=web&type=lyric&musicId=${id}`)
    return data?.data?.lrclist
      ? data.data.lrclist.map((l: any) => `[${l.time}]${l.lineLyric}`).join('\n')
      : null
  }
  return null
}
