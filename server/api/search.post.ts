import { searchPlatform, listSearchablePlatforms, PLATFORM_LABELS } from '~~/server/services/platformSearch'
import { listEnabledOkSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ platform?: string; keyword?: string; page?: number }>(event)
  const platform = body?.platform || 'wy'
  const keyword = body?.keyword || ''
  const page = body?.page || 1
  const items = await searchPlatform(platform, keyword, page)
  const sources = listEnabledOkSources(platform)
  return {
    platform,
    platforms: listSearchablePlatforms().map((p) => ({
      id: p,
      label: PLATFORM_LABELS[p] || p,
      sourceCount: listEnabledOkSources(p).length,
    })),
    sourceHint: sources.map((s) => s.name),
    items,
  }
})
