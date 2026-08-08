import { batchRetryTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; resetAttempts?: boolean }>(event)
  if (!body?.ids?.length) {
    throw createError({ statusCode: 400, statusMessage: 'ids 必填' })
  }
  return batchRetryTasks(body.ids, { resetAttempts: body.resetAttempts !== false })
})
