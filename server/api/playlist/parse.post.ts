import { parsePlaylist } from '~~/server/services/playlistService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string }>(event)
  return await parsePlaylist(body?.url || '')
})
