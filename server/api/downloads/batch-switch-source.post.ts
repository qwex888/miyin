import { batchSwitchSourceAndRetry } from '~~/server/services/downloadQueue'
import { parseTaskFilter } from '~~/server/utils/taskFilter'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    ids?: string[]
    sourceId?: string
    sourceById?: Record<string, string>
    allWithTab?: 'failed'
    filters?: unknown
  }>(event)
  if (!body?.ids?.length && body?.allWithTab !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab: "failed"' })
  }
  return batchSwitchSourceAndRetry(body.ids || [], {
    sourceId: body.sourceId,
    sourceById: body.sourceById,
    tab: body.allWithTab,
    filter: parseTaskFilter(body.filters),
  })
})
