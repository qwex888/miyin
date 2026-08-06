import { randomUUID } from 'node:crypto'
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
}

export type PlaylistDraft = {
  platform: string
  title: string
  url: string
  tracks: PlaylistTrackDraft[]
}

/**
 * 解析歌单链接（一期最小实现）：
 * - 网易云：playlist?id= / playlist/数字
 * - 其它：暂不支持完整抓取，返回可解析的平台提示
 */
export async function parsePlaylist(url: string): Promise<PlaylistDraft> {
  const raw = url.trim()
  if (!raw) throw createError({ statusCode: 400, statusMessage: '请输入歌单链接' })

  const wy = raw.match(/(?:music\.163\.com).*?(?:playlist\?id=|playlist\/)(\d+)/i) || raw.match(/playlist\?id=(\d+)/i)
  if (wy?.[1]) {
    return await parseNeteasePlaylist(wy[1], raw)
  }

  const qq = raw.match(/y\.qq\.com\/.*playlist/i)
  if (qq) {
    throw createError({
      statusCode: 501,
      statusMessage: 'QQ 歌单解析将在后续完善；当前请用网易云歌单链接，或手动搜索下载',
    })
  }

  throw createError({ statusCode: 400, statusMessage: '暂不支持该歌单链接，目前支持网易云 playlist 链接' })
}

async function parseNeteasePlaylist(id: string, url: string): Promise<PlaylistDraft> {
  const api = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(api, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://music.163.com/',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const pl = data?.playlist
    if (!pl) throw new Error('歌单不存在或接口失败')
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
  } finally {
    clearTimeout(t)
  }
}

export async function matchAndEnqueuePlaylist(
  draft: PlaylistDraft,
  opts?: { quality?: string; downloadLyric?: boolean; onlyMatched?: boolean },
) {
  const batchId = randomUUID()
  const results: Array<{ title: string; ok: boolean; method?: string; error?: string; taskId?: string }> = []

  for (const track of draft.tracks) {
    try {
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
