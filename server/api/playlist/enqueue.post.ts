import {
  parsePlaylist,
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
} from '~~/server/services/playlistService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    url?: string
    title?: string
    platform?: string
    tracks?: PlaylistTrackDraft[]
    quality?: string
    downloadLyric?: boolean
    lyricMode?: 'external' | 'embedded'
  }>(event)

  const opts = {
    quality: body?.quality,
    downloadLyric: body?.downloadLyric,
    lyricMode: body?.lyricMode,
  }

  // 已解析的选中曲目：直接入队，不再重新抓取歌单
  if (body?.tracks?.length) {
    return await matchAndEnqueuePlaylist(
      {
        platform: body.platform || body.tracks[0]?.platform || 'wy',
        title: body.title || '选中曲目',
        url: body.url || '',
        tracks: body.tracks,
      },
      opts,
    )
  }

  const draft = await parsePlaylist(body?.url || '')
  return await matchAndEnqueuePlaylist(draft, opts)
})
