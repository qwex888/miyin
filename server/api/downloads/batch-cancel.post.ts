import { batchCancelTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; allWithTab?: 'running' }>(event)
  if (!body?.ids?.length && body?.allWithTab !== 'running') {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab: "running"' })
  }
  return batchCancelTasks(body.ids, { tab: body.allWithTab })
})
