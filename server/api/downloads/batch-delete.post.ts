import { batchDeleteTasks } from '~~/server/services/downloadQueue'
import { resolveDeleteRequest } from '~~/server/utils/deleteFilter'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    ids?: string[]
    deleteLocalFiles?: boolean
    allWithTab?: string
    filters?: unknown
  }>(event)

  // 先完成 fail-closed 校验再调用删除：非法 filters 不能退化成整分类删除
  const { ids, tab, filter } = resolveDeleteRequest(body)

  return batchDeleteTasks(ids, {
    deleteLocalFiles: !!body?.deleteLocalFiles,
    tab,
    // allWithTab 表示「该分类在当前筛选下的全部」，条件必须一起下发
    filter,
  })
})
