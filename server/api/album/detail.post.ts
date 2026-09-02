import { getAlbumDetail } from '~~/server/services/platformAlbum'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ platform?: string; albumId?: string }>(event)
  const platform = body?.platform || 'wy'
  const albumId = body?.albumId || ''
  return await getAlbumDetail(platform, albumId)
})
