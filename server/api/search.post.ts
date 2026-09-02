import { searchPlatform, listSearchablePlatforms } from '~~/server/services/platformSearch'
import { searchAlbums, listAlbumCapablePlatforms } from '~~/server/services/platformAlbum'
import { platformLabel } from '#shared/platforms'
import { listEnabledOkSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    platform?: string
    keyword?: string
    page?: number
    type?: 'song' | 'album'
  }>(event)
  const platform = body?.platform || 'wy'
  const keyword = body?.keyword || ''
  const page = body?.page || 1
  const type = body?.type === 'album' ? 'album' : 'song'

  const albumCapable = listAlbumCapablePlatforms()
  const searchable = listSearchablePlatforms()

  if (type === 'album') {
    const items = await searchAlbums(platform, keyword, page)
    const sources = listEnabledOkSources(platform)
    return {
      type,
      platform,
      platforms: searchable.map((p) => ({
        id: p,
        label: platformLabel(p),
        sourceCount: listEnabledOkSources(p).length,
        albumCapable: albumCapable.includes(p as (typeof albumCapable)[number]),
      })),
      sourceHint: sources.map((s) => s.name),
      items,
    }
  }

  const items = await searchPlatform(platform, keyword, page)
  const sources = listEnabledOkSources(platform)
  return {
    type,
    platform,
    platforms: searchable.map((p) => ({
      id: p,
      label: platformLabel(p),
      sourceCount: listEnabledOkSources(p).length,
      albumCapable: albumCapable.includes(p as (typeof albumCapable)[number]),
    })),
    sourceHint: sources.map((s) => s.name),
    items,
  }
})
