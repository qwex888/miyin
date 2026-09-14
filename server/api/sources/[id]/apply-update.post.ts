import { applySourceUpdateFromInfo } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  return await applySourceUpdateFromInfo(id)
})
