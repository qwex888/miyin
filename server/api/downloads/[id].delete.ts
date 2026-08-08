import { cancelTask } from '~~/server/services/downloadQueue'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  return cancelTask(id)
})
