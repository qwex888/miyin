import { batchDeleteTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; deleteLocalFiles?: boolean; allWithTab?: 'completed' | 'failed' }>(event)
  if (!body?.ids?.length && !body?.allWithTab) {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab' })
  }
  return batchDeleteTasks(body.ids, {
    deleteLocalFiles: !!body.deleteLocalFiles,
    tab: body.allWithTab,
  })
})
