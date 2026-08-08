import { switchQualityAndRetry } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const body = await readBody<{ quality?: string }>(event).catch(() => ({} as { quality?: string }))
  if (!body?.quality) {
    throw createError({ statusCode: 400, statusMessage: '缺少 quality' })
  }
  return switchQualityAndRetry(id, body.quality)
})
