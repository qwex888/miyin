import { deleteTask } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const body = await readBody<{ deleteLocalFiles?: boolean }>(event).catch(() => ({}))
  return deleteTask(id, { deleteLocalFiles: !!(body as any)?.deleteLocalFiles })
})
