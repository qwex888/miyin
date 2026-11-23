import type { TaskListFilter } from '../services/downloadQueue'

/**
 * 400 错误不依赖 h3 的 createError：该模块会被 Vitest 直接导入，
 * 而 h3 只随 Nitro 构建存在，顶层并不保证可解析。带 statusCode 的 Error
 * 仍会被 Nitro 的错误处理器识别为 HTTP 400。
 */
type BadRequestError = Error & { statusCode: number; statusMessage: string }

function badRequest(message: string): BadRequestError {
  const err = new Error(message) as BadRequestError
  err.statusCode = 400
  err.statusMessage = message
  return err
}

/**
 * 删除接口的筛选条件解析。
 *
 * 查询接口对非法条件可以 fail-open（少筛几条，列表会显示出来），
 * 但删除接口 fail-open 会退化成「整个分类全删」—— 所以这里一律 fail-closed：
 * 未知字段、非字符串、空白串、非法日期都直接 400，宁可拒绝也不扩大删除范围。
 */
const FIELD_MAP: Record<string, keyof TaskListFilter> = {
  playlist_url: 'playlistUrl',
  batch_id: 'batchId',
  q: 'q',
  platform: 'platform',
  quality: 'quality',
  since: 'since',
  until: 'until',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `2026-02-31` 会被 Date 归一化成 3 月，删除区间因此变宽，必须原样合法 */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

export function parseDeleteFilter(raw: unknown): TaskListFilter {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('filters 必须是对象')
  }

  const filter: TaskListFilter = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_MAP[key]
    // 拼错字段名等于条件凭空消失，必须报错而不是忽略
    if (!field) {
      throw badRequest(`未知筛选字段: ${key}`)
    }
    if (value === undefined || value === null) continue
    // 空串在删除路径上同样视为非法：静默忽略会让 WHERE 退化成整个分类
    if (typeof value !== 'string' || !value.trim()) {
      throw badRequest(`筛选字段 ${key} 必须是非空字符串`)
    }
    const trimmed = value.trim()
    if ((field === 'since' || field === 'until') && !isRealDate(trimmed)) {
      throw badRequest(`${key} 必须是合法的 YYYY-MM-DD`)
    }
    filter[field] = trimmed
  }
  return filter
}

export type DeleteTab = 'completed' | 'failed'

export function resolveDeleteRequest(body: unknown): {
  ids?: string[]
  tab?: DeleteTab
  filter: TaskListFilter
} {
  const raw = (body || {}) as Record<string, unknown>

  let ids: string[] | undefined
  if (raw.ids !== undefined && raw.ids !== null) {
    if (!Array.isArray(raw.ids) || raw.ids.some((id) => typeof id !== 'string' || !id.trim())) {
      throw badRequest('ids 必须是非空字符串数组')
    }
    const normalized = (raw.ids as string[]).map((id) => id.trim())
    ids = normalized.length ? normalized : undefined
  }

  if (
    raw.allWithTab !== undefined &&
    raw.allWithTab !== null &&
    raw.allWithTab !== 'completed' &&
    raw.allWithTab !== 'failed'
  ) {
    throw badRequest('allWithTab 仅支持 completed / failed')
  }
  const tab = raw.allWithTab === 'completed' || raw.allWithTab === 'failed' ? raw.allWithTab : undefined

  if (!ids?.length && !tab) {
    throw badRequest('请提供 ids 或 allWithTab')
  }

  return { ids, tab, filter: parseDeleteFilter(raw.filters) }
}
