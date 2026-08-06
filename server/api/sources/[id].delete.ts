import { deleteSource } from '~~/server/services/sourceRegistry'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  return deleteSource(id)
})
