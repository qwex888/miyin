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
  const source = body.sourceId ? getSource(body.sourceId) : sources[0]
  if (!source?.local_path) {
    throw createError({ statusCode: 400, statusMessage: '没有可用音源，请先导入并检测音源' })
  }
  const handle = loadLxSource(source.local_path)
  try {
    const available = handle.qualityMap[body.platform] || ['128k', '320k']
    const quality = pickQuality(available, body.quality || settings.defaultQuality)
    const url = await handle.getMusicUrl(body.platform, body.musicInfo, quality)
    return { url, quality, sourceId: source.id, sourceName: source.name }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `试听取链失败: ${err?.message || err}` })
  } finally {
    handle.dispose()
  }
})
