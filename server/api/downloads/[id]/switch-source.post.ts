import { switchSourceAndRetry } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const body = await readBody<{ sourceId?: string }>(event).catch(() => ({} as { sourceId?: string }))
  return switchSourceAndRetry(id, { sourceId: body?.sourceId })
})
