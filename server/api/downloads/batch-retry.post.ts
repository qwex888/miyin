import { batchRetryTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; resetAttempts?: boolean; allWithTab?: 'failed' }>(event)
  if (!body?.ids?.length && body?.allWithTab !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab: "failed"' })
  }
  return batchRetryTasks(body.ids, {
    resetAttempts: body.resetAttempts !== false,
    tab: body.allWithTab,
  })
})
