import { getDb } from '../utils/db'

/**
 * 音源评分：用**实测表现**决定"先探谁"。
 *
 * ⚠️ 它**不**决定"下哪个" —— 那由 `processTask` 按实测码率择优。
 * 评分只影响探测顺序，所以算错了最多慢一点，不会下错文件。
 *
 * 为什么不用"最新导入优先"：那正是上一轮的 bug 成因 ——
 * 最新导入的 `聚合API`（只给试听）被排到首位，而能给 64MB 真 Hi-Res 的 `ynx`
 * （最早导入）排在最后、根本走不到。"新"与"可靠"没有因果关系。
 */

export type SourceOutcome = 'success' | 'preview' | 'quality-lie' | 'invalid-content'

/** 无历史记录时的中性分。给得不算低，保证新音源仍有被验证的机会（防马太效应） */
export const COLD_START_SCORE = 0.3

/** 指定音源的小幅优先加成：它"服务过这个任务"，值得先试一次 */
export const PRIMARY_BONUS = 0.1

/** 「近期成功」的判定窗口 */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 惩罚权重。**谎报比试听更重** —— 代价不同：
 * - 试听在 L1 探测阶段就被识别，只花一次请求头
 * - 谎报要**下完整个文件**才被 L2 魔数发现，白费带宽与时间
 *
 * **坏内容最重**：不仅白费整个文件的带宽，拿到的还是网页/残文件 ——
 * 落盘后曲库被污染，用户还得自己排查清理。
 */
const PREVIEW_PENALTY = 0.4
const LIE_PENALTY = 0.6
const INVALID_CONTENT_PENALTY = 0.8

type SourceStatRow = {
  source_id: string
  platform: string
  attempts: number
  successes: number
  previews: number
  quality_lies: number
  invalid_contents: number
  kbps_sum: number
  kbps_count: number
  last_success_at: string | null
}

/** 记一次音源表现。失败计数不影响流程 —— 统计坏了也不能让下载挂掉 */
export function recordSourceOutcome(input: {
  sourceId: string | null | undefined
  platform: string
  outcome: SourceOutcome
  /** 成功交付时的实测码率（kbps） */
  kbps?: number | null
}): void {
  if (!input.sourceId) return
  const isSuccess = input.outcome === 'success'
  const kbps = isSuccess && input.kbps && input.kbps > 0 ? input.kbps : 0
  try {
    getDb()
      .prepare(
        `INSERT INTO source_stats (
           source_id, platform, attempts, successes, previews, quality_lies, invalid_contents,
           kbps_sum, kbps_count, last_success_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, platform) DO UPDATE SET
           attempts = attempts + 1,
           successes = successes + excluded.successes,
           previews = previews + excluded.previews,
           quality_lies = quality_lies + excluded.quality_lies,
           invalid_contents = invalid_contents + excluded.invalid_contents,
           kbps_sum = kbps_sum + excluded.kbps_sum,
           kbps_count = kbps_count + excluded.kbps_count,
           last_success_at = COALESCE(excluded.last_success_at, source_stats.last_success_at)`,
      )
      .run(
        input.sourceId,
        input.platform,
        isSuccess ? 1 : 0,
        input.outcome === 'preview' ? 1 : 0,
        input.outcome === 'quality-lie' ? 1 : 0,
        input.outcome === 'invalid-content' ? 1 : 0,
        kbps,
        kbps ? 1 : 0,
        isSuccess ? new Date().toISOString() : null,
      )
  } catch {
    /* 统计是优化项，失败不影响下载 */
  }
}

function scoreOf(row: SourceStatRow, maxKbps: number): number {
  if (row.attempts <= 0) return COLD_START_SCORE
  const successRate = row.successes / row.attempts
  const avgKbps = row.kbps_count > 0 ? row.kbps_sum / row.kbps_count : 0
  const qualityScore = maxKbps > 0 ? Math.min(1, avgKbps / maxKbps) : 0
  // 没成功过的源不该拿到"新近度"加分
  const recent =
    row.successes > 0
      ? row.last_success_at && Date.now() - Date.parse(row.last_success_at) < RECENT_WINDOW_MS
        ? 1
        : 0.5
      : 0
  const previewRate = row.previews / row.attempts
  const lieRate = row.quality_lies / row.attempts
  const invalidRate = row.invalid_contents / row.attempts
  return (
    0.45 * successRate +
    0.4 * qualityScore +
    0.15 * recent -
    PREVIEW_PENALTY * previewRate -
    LIE_PENALTY * lieRate -
    INVALID_CONTENT_PENALTY * invalidRate
  )
}

/**
 * 某平台上各音源的评分。`avgKbps` 会按"该平台已知最高交付码率"归一化，
 * 所以"能交付真无损的源"会明显高于"只给 320k 的源"。
 */
export function sourceScores(platform: string): Map<string, number> {
  const scores = new Map<string, number>()
  try {
    const rows = getDb()
      .prepare(`SELECT * FROM source_stats WHERE platform = ?`)
      .all(platform) as SourceStatRow[]
    const maxKbps = rows.reduce(
      (max, r) => Math.max(max, r.kbps_count > 0 ? r.kbps_sum / r.kbps_count : 0),
      0,
    )
    for (const row of rows) scores.set(row.source_id, scoreOf(row, maxKbps))
  } catch {
    /* 读不到就当作全部冷启动 */
  }
  return scores
}
