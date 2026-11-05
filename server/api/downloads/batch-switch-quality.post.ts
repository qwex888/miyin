import { batchSwitchQualityAndRetry } from '~~/server/services/downloadQueue'
import { parseTaskFilter } from '~~/server/utils/taskFilter'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    ids?: string[]
    quality?: string
    allWithTab?: 'failed'
    filters?: unknown
  }>(event)
  if (!body?.quality?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'quality 必填' })
  }
  if (!body?.ids?.length && body?.allWithTab !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab: "failed"' })
  }
  return batchSwitchQualityAndRetry(body.ids || [], body.quality.trim(), {
    tab: body.allWithTab,
    filter: parseTaskFilter(body.filters),
  })
})
