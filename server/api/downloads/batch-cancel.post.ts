import { batchCancelTasks } from '~~/server/services/downloadQueue'
import { parseTaskFilter } from '~~/server/utils/taskFilter'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; allWithTab?: 'running'; filters?: unknown }>(event)
  if (!body?.ids?.length && body?.allWithTab !== 'running') {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab: "running"' })
  }
  // filters 与分类一起下发：只操作「筛选后的这一批」，否则全选会把筛选外的运行中任务一起取消
  return batchCancelTasks(body.ids, {
    tab: body.allWithTab,
    filter: parseTaskFilter(body.filters),
  })
})
