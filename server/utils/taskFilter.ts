/**
 * 批量操作（取消 / 重试 / 换音质 / 换源 / 删除）的筛选条件解析。
 *
 * 为什么单独一个模块：查询接口对非法条件可以 fail-open（忽略条件只是多显示几行，
 * 用户一眼能看出不对），但批量操作 fail-open 会把「操作筛选结果」悄悄放大成
 * 「操作整个分类」。这类错误一旦发生就是数据丢失，所以这里一律 fail-closed：
 * 只要入参有歧义就 400，宁可不执行。
 *
 * 字段名与 `/api/downloads` 的 query 参数保持一致（snake_case），但**不接受**
 * 空串：查询接口里空串等于「未设置」只是多显示几行，批量操作里空串一旦被
 * 当成「未设置」，条件就凭空消失、作用域退化成整个分类 —— 与本次修复要堵的
 * 是同一个洞。前端本来就不会发空值，所以空串只可能是调用方 bug，直接 400。
 */

export interface TaskFilter {
  playlistUrl?: string
  batchId?: string
  q?: string
  platform?: string
  quality?: string
  since?: string
  until?: string
}

const FIELD_MAP: Record<string, keyof TaskFilter> = {
  playlist_url: 'playlistUrl',
  batch_id: 'batchId',
  q: 'q',
  platform: 'platform',
  quality: 'quality',
  since: 'since',
  until: 'until',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 严格日期校验。
 *
 * 不能用 `nextDayOf` 那种「归一化后仍可用」的宽松判断：`2026-02-31` 会被
 * Date 归一化成 3-03，`nextDayOf` 再推到 3-04，于是「删到 2 月底」变成
 * 「删到 3 月 4 日」——多删两天。批量操作必须是原样合法的日期。
 */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

export function parseTaskFilter(raw: unknown): TaskFilter {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'filters 必须是对象' })
  }

  const out: TaskFilter = {}
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_MAP[rawKey]
    // 拼错字段名 = 条件凭空消失 = 扩大作用域，必须报错而不是忽略
    if (!field) {
      throw createError({ statusCode: 400, statusMessage: `未知筛选字段: ${rawKey}` })
    }
    if (rawValue === undefined || rawValue === null) continue
    if (typeof rawValue !== 'string') {
      throw createError({ statusCode: 400, statusMessage: `筛选字段 ${rawKey} 必须是字符串` })
    }
    const value = rawValue.trim()
    // 空串不当作「未设置」：批量操作里条件消失 = 作用域放大到整个分类
    if (!value) {
      throw createError({ statusCode: 400, statusMessage: `筛选字段 ${rawKey} 不能为空` })
    }
    if (field === 'since' || field === 'until') {
      if (!isRealDate(value)) {
        throw createError({ statusCode: 400, statusMessage: `${rawKey} 必须是合法的 YYYY-MM-DD` })
      }
    }
    out[field] = value
  }
  return out
}
