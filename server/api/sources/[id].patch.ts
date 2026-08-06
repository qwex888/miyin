import { updateSource } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const body = await readBody<{ enabled?: boolean }>(event)
  return updateSource(id, body || {})
})
