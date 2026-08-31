import { listTasks, getTaskStats } from '~~/server/services/downloadQueue'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const status = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : undefined
  const playlistUrl = typeof query.playlist_url === 'string' && query.playlist_url.trim() ? query.playlist_url.trim() : undefined
  const batchId = typeof query.batch_id === 'string' && query.batch_id.trim() ? query.batch_id.trim() : undefined
  const page = query.page != null ? Number(query.page) : undefined
  const pageSize = query.pageSize != null ? Number(query.pageSize) : (query.page_size != null ? Number(query.page_size) : undefined)
  const limit = query.limit != null ? Number(query.limit) : undefined

  const items = listTasks({
    status,
    playlistUrl,
    batchId,
    page,
    pageSize,
    limit,
  })

  // 如果带了分页参数，附带统计信息返回
  if (page && pageSize) {
    const stats = getTaskStats({ playlistUrl, batchId })
    const total = status ? (stats as Record<string, number>)[status] || 0 : stats.total
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  return { items }
})
