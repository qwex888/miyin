import { parsePlaylist, matchAndEnqueuePlaylist } from '~~/server/services/playlistService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    url?: string
    quality?: string
    downloadLyric?: boolean
  }>(event)
  const draft = await parsePlaylist(body?.url || '')
  return await matchAndEnqueuePlaylist(draft, {
    quality: body?.quality,
    downloadLyric: body?.downloadLyric,
  })
})
