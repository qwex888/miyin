import { listEnabledOkSources, getSource } from '~~/server/services/sourceRegistry'
import { loadLxSource, pickQuality } from '~~/server/services/sourceRuntime'
import { getSettings } from '~~/server/services/settingsService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    platform: string
    musicInfo: Record<string, any>
    quality?: string
    sourceId?: string
  }>(event)
  if (!body?.platform || !body?.musicInfo) {
    throw createError({ statusCode: 400, statusMessage: 'platform/musicInfo 必填' })
  }
  const settings = getSettings()
  const sources = listEnabledOkSources(body.platform)
  if (!sources.length) {
    throw createError({ statusCode: 400, statusMessage: '没有可用音源，请先导入并检测音源' })
  }

  const ordered = body.sourceId
    ? [getSource(body.sourceId), ...sources.filter((s) => s.id !== body.sourceId)].filter(Boolean)
    : sources

  const errors: string[] = []
  const qualityPref = body.quality || settings.defaultQuality

  for (const source of ordered as NonNullable<ReturnType<typeof getSource>>[]) {
    if (!source?.local_path) continue
    try {
      const handle = await loadLxSource(source.local_path)
      const available = handle.qualityMap[body.platform] || ['128k', '320k']
      const quality = pickQuality(available, qualityPref)
      const url = await handle.getMusicUrl(body.platform, body.musicInfo, quality)
      return { url, quality, sourceId: source.id, sourceName: source.name }
    } catch (err: any) {
      errors.push(`${source.name}: ${err?.message || err}`)
    }
  }

  throw createError({
    statusCode: 502,
    statusMessage: `试听取链失败（已尝试 ${errors.length} 个音源）: ${errors.join(' | ')}`,
  })
})
