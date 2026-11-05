import type { TaskListFilter } from '~~/server/services/downloadQueue'
import { batchDeleteTasks } from '~~/server/services/downloadQueue'

function str(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 与 /api/downloads、/api/downloads/stats 同名的查询条件 */
function parseFilter(raw: unknown): TaskListFilter {
  const f = (raw || {}) as Record<string, unknown>
  return {
    playlistUrl: str(f.playlist_url),
    batchId: str(f.batch_id),
    q: str(f.q),
    platform: str(f.platform),
    quality: str(f.quality),
    since: str(f.since),
    until: str(f.until),
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    ids?: string[]
    deleteLocalFiles?: boolean
    allWithTab?: string
    filters?: unknown
  }>(event)
  const tab = body?.allWithTab === 'completed' || body?.allWithTab === 'failed'
    ? body.allWithTab
    : undefined
  if (!body?.ids?.length && !tab) {
    throw createError({ statusCode: 400, statusMessage: '请提供 ids 或 allWithTab' })
  }
  return batchDeleteTasks(body.ids, {
    deleteLocalFiles: !!body.deleteLocalFiles,
    tab,
    // allWithTab 表示「该分类在当前筛选下的全部」，条件必须一起下发，否则会删到未筛选的任务
    filter: parseFilter(body.filters),
  })
})
