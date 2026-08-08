import { batchDeleteTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; deleteLocalFiles?: boolean }>(event)
  if (!body?.ids?.length) {
    throw createError({ statusCode: 400, statusMessage: 'ids 必填' })
  }
  return batchDeleteTasks(body.ids, { deleteLocalFiles: !!body.deleteLocalFiles })
})
