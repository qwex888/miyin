import { getAlbumTracksPage } from '~~/server/services/platformAlbum'

/**
 * 专辑曲目分页（Issue #40）。
 *
 * - `cursor` = 已加载条数（缺省 0），服务端会向下对齐到上游页边界；
 * - 一次只返回一页，`hasMore` 为真时前端触底加载；
 * - 整专下载不走本接口，走 `/api/album/enqueue-all`（服务端自己翻页 + NDJSON 进度）。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    platform?: string
    albumId?: string
    cursor?: number
    albumTitle?: string
    albumArtist?: string
    albumCover?: string
  }>(event)

  const platform = body?.platform || 'wy'
  const albumId = body?.albumId || ''
  const cursor = Math.max(0, Math.floor(Number(body?.cursor) || 0))

  return await getAlbumTracksPage(platform, albumId, cursor, {
    title: body?.albumTitle || undefined,
    artist: body?.albumArtist || undefined,
    cover: body?.albumCover || undefined,
  })
})
