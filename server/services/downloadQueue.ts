import { EventEmitter } from 'node:events'
import {
  createWriteStream,
  unlinkSync,
  existsSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildDedupKey, buildSearchText, tokenizeQuery } from '#shared/trackKey'
import PQueue from 'p-queue'
import { getDb, checkpointAndShrinkDb } from '../utils/db'
import { getDownloadDir } from '../utils/paths'
import type { TaskFilter } from '../utils/taskFilter'
import {
  assertDownloadDirWritable,
  ensureDownloadDirWritable,
  isDownloadPermissionError,
} from '../utils/downloadDir'
import { getSettings, type AppSettings } from './settingsService'
import { findDuplicates, type DuplicateMatch } from './duplicateGuard'
import { listEnabledOkSources } from './sourceRegistry'
import { isHighestQuality, listMusicUrlCandidates } from './musicUrlResolve'
import { recordSourceOutcome } from './sourceStats'
import { fetchLyric } from './lyricService'
import { writeAudioMetadata } from './metadataService'
import { sniffAudioExt, isLosslessClaimMismatch } from '../utils/audioSniff'
import {
  allPreviewError,
  expectedDurationFromMusicInfo,
  isLikelyPreviewByAbsoluteDuration,
  isLikelyPreviewClip,
  isLikelyPreviewUrl,
  minFullTrackBytes,
  previewClipError,
  previewSizeError,
  probeAudioInfo,
  probeCandidate,
  type CandidateVerdict,
} from '../utils/audioPreview'
import { correctedQualityFromProbe, qualityFromBitrate } from '#shared/quality'
import { nextStatusAfterFailure, isRetryableError, isAllowedQuality } from './downloadState'
import { msUntilCanStartTask } from '../utils/downloadIntervals'
export type { TaskStatus } from './downloadState'
export { nextStatusAfterFailure, isRetryableError } from './downloadState'

/** 疑似重复的裁决：跳过 / 替换既有记录 / 强制入队（接受覆盖） */
export type DuplicateAction = 'skip' | 'replace' | 'enqueue'

export type DownloadTaskRow = {
  id: string
  title: string
  artist: string
  album: string | null
  platform: string
  source_id: string | null
  quality: string | null
  status: string
  progress: number
  file_path: string | null
  lyric_path: string | null
  error: string | null
  attempts: number
  external_id: string | null
  match_method: string | null
  match_score: number | null
  batch_id: string | null
  playlist_url: string | null
  music_info_json: string | null
  file_size: number | null
  dedup_key: string | null
  search_text: string | null
  created_at: string
  updated_at: string
}

export const downloadEvents = new EventEmitter()
downloadEvents.setMaxListeners(50)

let downloadQueue: PQueue | null = null
let currentQueueConcurrency = 1
let loopTimer: NodeJS.Timeout | null = null
let intervalKickTimer: NodeJS.Timeout | null = null
/** 上次启动任务时间戳（ms） */
let lastStartedAt: number | null = null
/** 上次任务结束时间戳（ms，成功/失败/取消均计） */
let lastFinishedAt: number | null = null
let idleShrinkTimer: NodeJS.Timeout | null = null
const activeAbortControllers = new Map<string, AbortController>()
const activeProcessingTasks = new Set<string>()
const inFlightQueueTaskIds = new Set<string>()
let isTicking = false
function scheduleIdleShrinkDb() {
  if (idleShrinkTimer) clearTimeout(idleShrinkTimer)
  idleShrinkTimer = setTimeout(() => {
    idleShrinkTimer = null
    if (activeProcessingTasks.size === 0 && (!downloadQueue || downloadQueue.pending === 0)) {
      checkpointAndShrinkDb()
    }
  }, 5000)
}

function getOrCreateDownloadQueue(concurrency: number): PQueue {
  if (!downloadQueue) {
    downloadQueue = new PQueue({ concurrency, autoStart: true })
    currentQueueConcurrency = concurrency
  } else if (downloadQueue.concurrency !== concurrency) {
    downloadQueue.concurrency = concurrency
    currentQueueConcurrency = concurrency
  }
  return downloadQueue
}

function scheduleKickAfter(ms: number) {
  if (ms <= 0) {
    kickWorker()
    return
  }
  if (intervalKickTimer) clearTimeout(intervalKickTimer)
  intervalKickTimer = setTimeout(() => {
    intervalKickTimer = null
    kickWorker()
  }, ms)
}

function nowIso() {
  return new Date().toISOString()
}

/** Sanitize one path segment; `/` `\` become `_` so metadata cannot inject directories. */
function sanitizePathSegment(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

/** Split a filled template into sanitized relative path segments (`/` as dirs). */
function pathSegmentsFromFilled(filled: string, emptyFallback?: string) {
  const segments = filled
    .split(/[/\\]+/)
    .map((s) => sanitizePathSegment(s))
    .filter((s) => s && s !== '.' && s !== '..')
  if (segments.length) return segments.join('/')
  return emptyFallback ?? ''
}

/**
 * Apply download name template. `/` or `\` in the template create subdirectories;
 * each segment is sanitized. Empty segments (e.g. missing `{album}`) and `.` / `..` are dropped.
 */
export function applyNameTemplate(
  template: string,
  meta: {
    artist: string
    title: string
    album?: string
    platform?: string
    quality?: string
    id?: string
    track?: string | number
  },
) {
  const filled = template
    .replaceAll('{artist}', sanitizePathSegment(meta.artist || '未知') || '未知')
    .replaceAll('{title}', sanitizePathSegment(meta.title || '未知') || '未知')
    .replaceAll('{album}', sanitizePathSegment(meta.album || ''))
    .replaceAll('{platform}', sanitizePathSegment(meta.platform || ''))
    .replaceAll('{quality}', sanitizePathSegment(meta.quality || ''))
    .replaceAll('{id}', sanitizePathSegment(meta.id || ''))
    .replaceAll(
      '{track}',
      meta.track != null ? sanitizePathSegment(String(meta.track)) : '',
    )

  return pathSegmentsFromFilled(filled, 'unknown')
}

/** Album-level folder template (`{album}` / `{artist}` / `{platform}`); empty if nothing left. */
export function applyFolderTemplate(
  template: string,
  meta: { album?: string; artist?: string; platform?: string },
) {
  const filled = template
    .replaceAll('{artist}', sanitizePathSegment(meta.artist || ''))
    .replaceAll('{album}', sanitizePathSegment(meta.album || ''))
    .replaceAll('{platform}', sanitizePathSegment(meta.platform || ''))
  return pathSegmentsFromFilled(filled, '')
}

/** File name from global template, optionally under a resolved album folder prefix. */
export function buildDownloadRelativeBase(
  nameTemplate: string,
  trackMeta: {
    artist: string
    title: string
    album?: string
    platform?: string
    quality?: string
    id?: string
    track?: string | number
  },
  folderPrefix?: string | null,
) {
  const fileBase = applyNameTemplate(nameTemplate, trackMeta)
  const prefix = pathSegmentsFromFilled(folderPrefix || '', '')
  return prefix ? `${prefix}/${fileBase}` : fileBase
}

/** Join download root with a template-relative base (may contain `/` segments). */
export function joinDownloadRelative(root: string, relativeBase: string, ext?: string) {
  const parts = relativeBase.split('/').filter(Boolean)
  if (ext) {
    const last = parts.pop() || 'unknown'
    parts.push(`${last}.${ext}`)
  }
  return join(root, ...parts)
}

function ensureParentDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
}

/**
 * 下载临时文件标记。所有下载先落 `<name>.part.<ext>`，校验通过后再原子 rename 到最终路径。
 *
 * 放在扩展名**之前**（`.part.flac` 而非 `.flac.part`），保证 ffprobe / ffmpeg
 * 按扩展名推断格式时仍看到真实扩展名。
 */
const TEMP_SUFFIX = '.part'

export type ListTasksQuery = {
  status?: string
  statuses?: string[]
  tab?: 'running' | 'completed' | 'failed'
  playlistUrl?: string
  batchId?: string
/** 关键词检索：多 token AND 匹配 `search_text`（见 shared/trackKey.ts） */
  q?: string
  /** 平台过滤（wy / tx / kg …） */
  platform?: string
  /** 音质过滤；取值来自 shared/quality.QUALITY_LADDER（含 192k） */
  quality?: string
  /** 入队日期下界（含），YYYY-MM-DD */
  since?: string
  /** 入队日期上界（含），YYYY-MM-DD */
  until?: string
  page?: number
  pageSize?: number
  limit?: number
}

/** LIKE 通配符转义；token 归一化已去除标点，此处为防御性处理 */
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * 关键词 → `search_text LIKE ?` 子句（多 token AND）。
 * 多 token AND 使「周杰伦 稻香」与「稻香 周杰伦」结果一致（词序无关）。
 */
function buildKeywordClauses(keyword?: string) {
  const tokens = keyword ? tokenizeQuery(keyword) : []
  return {
    sql: tokens.map(() => `search_text LIKE ? ESCAPE '\\'`),
    params: tokens.map((token) => `%${escapeLikePattern(token)}%`),
  }
}

/** `YYYY-MM-DD` → 次日（用于把「含当天」的闭区间转成开区间上界） */
function nextDayOf(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return d.toISOString().slice(0, 10)
}

/**
 * 平台 / 音质 / 入队日期 过滤。
 * **列表与统计必须共用**，否则带筛选时分页 `total` 会按全量算（同 P0 的陷阱 1）。
 */
function buildMetaClauses(filter?: {
  platform?: string
  quality?: string
  since?: string
  until?: string
}) {
  const sql: string[] = []
  const params: unknown[] = []
  if (filter?.platform) {
    sql.push('platform = ?')
    params.push(filter.platform)
  }
  if (filter?.quality) {
    sql.push('quality = ?')
    params.push(filter.quality)
  }
  // created_at 是 ISO(UTC) 字符串，按字典序比较即等价于按时间比较。
  // 非法日期一律忽略：宁可不过滤，也不要静默筛成空列表
  if (filter?.since && /^\d{4}-\d{2}-\d{2}$/.test(filter.since)) {
    sql.push('created_at >= ?')
    params.push(filter.since)
  }
  if (filter?.until) {
    const next = nextDayOf(filter.until)
    if (next) {
      sql.push('created_at < ?')
      params.push(next)
    }
  }
  return { sql, params }
}

export function listTasks(queryOrStatus?: string | ListTasksQuery) {
  if (typeof queryOrStatus === 'string') {
    return getDb()
      .prepare('SELECT * FROM download_tasks WHERE status = ? ORDER BY created_at DESC')
      .all(queryOrStatus) as DownloadTaskRow[]
  }
  const query = queryOrStatus || {}
  const whereClauses: string[] = []
  const params: unknown[] = []

  if (query.tab) {
    if (query.tab === 'running') {
      whereClauses.push(`status IN ('running', 'queued')`)
    } else if (query.tab === 'completed') {
      whereClauses.push(`status = 'completed'`)
    } else if (query.tab === 'failed') {
      whereClauses.push(`status IN ('failed', 'cancelled')`)
    }
  } else if (query.statuses && query.statuses.length > 0) {
    const placeholders = query.statuses.map(() => '?').join(',')
    whereClauses.push(`status IN (${placeholders})`)
    params.push(...query.statuses)
  } else if (query.status) {
    whereClauses.push('status = ?')
    params.push(query.status)
  }

  if (query.playlistUrl) {
    whereClauses.push('playlist_url = ?')
    params.push(query.playlistUrl)
  }
  if (query.batchId) {
    whereClauses.push('batch_id = ?')
    params.push(query.batchId)
  }

  const keyword = buildKeywordClauses(query.q)
  whereClauses.push(...keyword.sql)
  params.push(...keyword.params)

  const meta = buildMetaClauses(query)
  whereClauses.push(...meta.sql)
  params.push(...meta.params)

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  let orderBySql = 'ORDER BY created_at DESC'
  if (query.tab === 'running') {
    // 下载中（running）排在最前，排队中（queued）按入队先后顺序排列
    orderBySql = `ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END ASC, created_at ASC`
  } else if (query.tab === 'completed') {
    orderBySql = `ORDER BY updated_at DESC, created_at DESC`
  }

  const page = query.page && query.page > 0 ? query.page : undefined
  const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 1000) : undefined

  if (page && pageSize) {
    const offset = (page - 1) * pageSize
    return getDb()
      .prepare(`SELECT * FROM download_tasks ${whereSql} ${orderBySql} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset) as DownloadTaskRow[]
  }

  const limit = query.limit && query.limit > 0 ? query.limit : 200
  return getDb()
    .prepare(`SELECT * FROM download_tasks ${whereSql} ${orderBySql} LIMIT ?`)
    .all(...params, limit) as DownloadTaskRow[]
}

export type TaskStats = {
  total: number
  completed: number
  failed: number
  running: number
  queued: number
  cancelled: number
}

export function getTaskStats(filter?: {
  playlistUrl?: string
  batchId?: string
  /** 必须与 listTasks 使用同一组过滤条件，否则分页 total 失真 */
  q?: string
  platform?: string
  quality?: string
  since?: string
  until?: string
}): TaskStats {
  const whereClauses: string[] = []
  const params: unknown[] = []

  if (filter?.playlistUrl) {
    whereClauses.push('playlist_url = ?')
    params.push(filter.playlistUrl)
  }
  if (filter?.batchId) {
    whereClauses.push('batch_id = ?')
    params.push(filter.batchId)
  }

  const keyword = buildKeywordClauses(filter?.q)
  whereClauses.push(...keyword.sql)
  params.push(...keyword.params)

  const meta = buildMetaClauses(filter)
  whereClauses.push(...meta.sql)
  params.push(...meta.params)

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT status, count(*) as count FROM download_tasks ${whereSql} GROUP BY status`)
    .all(...params) as Array<{ status: string; count: number }>

  const stats: TaskStats = {
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    queued: 0,
    cancelled: 0,
  }

  for (const row of rows) {
    const count = Number(row.count) || 0
    stats.total += count
    if (row.status === 'completed') stats.completed = count
    else if (row.status === 'failed') stats.failed = count
    else if (row.status === 'running') stats.running = count
    else if (row.status === 'queued') stats.queued = count
    else if (row.status === 'cancelled') stats.cancelled = count
  }

  return stats
}

export function getTask(id: string) {
  return getDb().prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as DownloadTaskRow | undefined
}

function emitTask(id: string) {
  const task = getTask(id)
  if (task) downloadEvents.emit('task', task)
}

function removeFileQuiet(path: string | null | undefined) {
  if (!path || !existsSync(path)) return
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
}

function removeTaskFiles(task: DownloadTaskRow) {
  removeFileQuiet(task.file_path)
  removeFileQuiet(task.lyric_path)
}

/**
 * 替换任务（⑦A）成功后的旧文件清理。
 *
 * 被替换的任务在 `music_info_json` 里记了旧路径 —— 因为替换是 **UPDATE 同一行**，
 * 新的 `file_path` 会覆盖旧值，不主动清理就会留下孤儿文件（R-d）。
 */
function cleanupReplacedFiles(task: DownloadTaskRow) {
  let musicInfo: Record<string, unknown> = {}
  try {
    musicInfo = JSON.parse(task.music_info_json || '{}')
  } catch {
    musicInfo = {}
  }
  const current = getTask(task.id)
  const oldFile = typeof musicInfo.__replaceOldFile === 'string' ? musicInfo.__replaceOldFile : null
  const oldLyric = typeof musicInfo.__replaceOldLyric === 'string' ? musicInfo.__replaceOldLyric : null
  // 新旧路径相同时 rename 已经就地覆盖，不能误删
  if (oldFile && oldFile !== current?.file_path) removeFileQuiet(oldFile)
  if (oldLyric && oldLyric !== current?.lyric_path) removeFileQuiet(oldLyric)
}

export type EnqueueDownloadInput = {
  title: string
  artist: string
  album?: string
  platform: string
  sourceId?: string
  quality?: string
  musicInfo: Record<string, unknown>
  externalId?: string
  matchMethod?: string
  downloadLyric?: boolean
  lyricMode?: 'external' | 'embedded'
  /** Resolved relative folder prefix for this task (album download); stored in music_info_json */
  folderPrefix?: string
  batchId?: string
  playlistUrl?: string
  /** 疑似重复时的裁决；缺省按 `duplicatePolicy`，`prompt` 下服务端回落 `skip`（D3） */
  duplicateAction?: DuplicateAction
}

export type EnqueueOutcome =
  | { kind: 'enqueued'; task: DownloadTaskRow }
  | { kind: 'replaced'; task: DownloadTaskRow; replacedFrom: string }
  | { kind: 'skipped'; duplicate: DuplicateMatch }

type PreparedEnqueue = {
  id: string
  ts: string
  sourceId: string
  quality: string
  musicPayload: Record<string, unknown>
}

/** 校验 + 解析音源。放在事务外：不涉及写入，抛错时无需回滚 */
function prepareEnqueue(input: EnqueueDownloadInput, settings: AppSettings): PreparedEnqueue {
  if (input.quality != null && input.quality !== '' && !isAllowedQuality(input.quality)) {
    throw createError({ statusCode: 400, statusMessage: `不支持的音质: ${input.quality}` })
  }
  const sources = listEnabledOkSources(input.platform)
  const sourceId = input.sourceId || sources[0]?.id
  if (!sourceId) {
    throw createError({ statusCode: 400, statusMessage: `没有可用音源支持平台 ${input.platform}` })
  }
  return {
    id: randomUUID(),
    ts: nowIso(),
    sourceId,
    quality: input.quality || settings.defaultQuality,
    musicPayload: {
      ...input.musicInfo,
      __downloadLyric: input.downloadLyric ?? settings.downloadLyric,
      __lyricMode: input.lyricMode ?? settings.lyricMode,
      ...(input.folderPrefix ? { __folderPrefix: input.folderPrefix } : {}),
    },
  }
}

/** 纯写入：不 emit、不 kick，便于被包进事务 */
function insertTaskRow(input: EnqueueDownloadInput, prepared: PreparedEnqueue) {
  getDb()
    .prepare(
      `INSERT INTO download_tasks (
        id, title, artist, album, platform, source_id, quality, status, progress,
        external_id, match_method, batch_id, playlist_url, music_info_json, file_size,
        dedup_key, search_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      prepared.id,
      input.title,
      input.artist,
      input.album || null,
      input.platform,
      prepared.sourceId,
      prepared.quality,
      input.externalId || null,
      input.matchMethod || 'id',
      input.batchId || null,
      input.playlistUrl || null,
      JSON.stringify(prepared.musicPayload),
      buildDedupKey(input.artist, input.title),
      buildSearchText({ title: input.title, artist: input.artist, album: input.album }),
      prepared.ts,
      prepared.ts,
    )
}

/**
 * 无条件入队（**语义保持不变**）。
 *
 * 等价于用户显式选择「入队 / 接受覆盖」—— 不做判重。判重走 `enqueueDownloadChecked`。
 */
export function enqueueDownload(input: EnqueueDownloadInput) {
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)
  const prepared = prepareEnqueue(input, settings)
  insertTaskRow(input, prepared)
  emitTask(prepared.id)
  kickWorker()
  return getTask(prepared.id)!
}

/**
 * 裁决优先级：显式传入 > `input.duplicateAction` > 设置策略。
 * `prompt` 且未给裁决时回落 `skip` —— **服务端不得静默覆盖**（D3）。
 */
export function resolveDuplicateAction(
  input: { duplicateAction?: DuplicateAction },
  override: DuplicateAction | undefined,
  settings: AppSettings,
): DuplicateAction {
  const explicit = override ?? input.duplicateAction
  if (explicit) return explicit
  return settings.duplicatePolicy === 'replace' ? 'replace' : 'skip'
}

function duplicateCandidateOf(input: EnqueueDownloadInput, settings: AppSettings) {
  return {
    title: input.title,
    artist: input.artist,
    album: input.album,
    quality: input.quality || settings.defaultQuality,
  }
}

/** 替换：**UPDATE 既有行**（复用同一 task id），记下旧路径待新文件落地后清理（R-d） */
function updateRowForReplace(
  taskId: string,
  input: EnqueueDownloadInput,
  prepared: PreparedEnqueue,
  settings: AppSettings,
) {
  const existing = getTask(taskId)
  if (!existing) throw createError({ statusCode: 404, statusMessage: '替换目标不存在' })

  const musicPayload = {
    ...prepared.musicPayload,
    ...(existing.file_path ? { __replaceOldFile: existing.file_path } : {}),
    ...(existing.lyric_path ? { __replaceOldLyric: existing.lyric_path } : {}),
  }

  getDb()
    .prepare(
      `UPDATE download_tasks SET
         title = ?, artist = ?, album = ?, platform = ?, source_id = ?, quality = ?,
         status = 'queued', progress = 0, error = NULL, attempts = 0,
         external_id = ?, match_method = ?, music_info_json = ?,
         dedup_key = ?, search_text = ?,
         file_path = NULL, lyric_path = NULL, file_size = NULL,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.title,
      input.artist,
      input.album || null,
      input.platform,
      prepared.sourceId,
      input.quality || settings.defaultQuality,
      input.externalId || null,
      input.matchMethod || 'id',
      JSON.stringify(musicPayload),
      buildDedupKey(input.artist, input.title),
      buildSearchText({ title: input.title, artist: input.artist, album: input.album }),
      prepared.ts,
      taskId,
    )
}

/**
 * 带判重的单曲入队。
 *
 * 判重查询与写入放在**同一事务**内（D4）：better-sqlite3 同步执行，
 * 并发的另一次入队只能落在本事务之前（被检出）或之后（会检出本次），没有中间窗口。
 */
export function enqueueDownloadChecked(
  input: EnqueueDownloadInput,
  opts?: { action?: DuplicateAction },
): EnqueueOutcome {
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)
  const prepared = prepareEnqueue(input, settings)
  const action = resolveDuplicateAction(input, opts?.action, settings)

  if (!settings.duplicateCheckEnabled || action === 'enqueue') {
    insertTaskRow(input, prepared)
    emitTask(prepared.id)
    kickWorker()
    return { kind: 'enqueued', task: getTask(prepared.id)! }
  }

  const decision = getDb().transaction(() => {
    const hit = findDuplicates([duplicateCandidateOf(input, settings)]).get(
      buildDedupKey(input.artist, input.title),
    )
    if (!hit) {
      insertTaskRow(input, prepared)
      return { kind: 'enqueued' as const }
    }
    if (action === 'skip') {
      return { kind: 'skipped' as const, duplicate: hit }
    }
    // ④A：即便策略是「自动替换」，低音质覆盖高音质也必须拦下来 ——
    // 否则 duplicatePolicy='replace' 会把音质保护整个绕过
    if (hit.qualityInverted) {
      return { kind: 'skipped' as const, duplicate: hit }
    }
    const replacedFrom = hit.existing!.id
    updateRowForReplace(replacedFrom, input, prepared, settings)
    return { kind: 'replaced' as const, replacedFrom }
  })()

  if (decision.kind === 'enqueued') {
    emitTask(prepared.id)
    kickWorker()
    return { kind: 'enqueued', task: getTask(prepared.id)! }
  }
  if (decision.kind === 'skipped') {
    return { kind: 'skipped', duplicate: decision.duplicate }
  }
  emitTask(decision.replacedFrom)
  kickWorker()
  return {
    kind: 'replaced',
    task: getTask(decision.replacedFrom)!,
    replacedFrom: decision.replacedFrom,
  }
}

/**
 * 批量任务入库：使用 SQLite 事务进行高效分批写入，避免循环单个 insert 导致的 WAL 和事件广播压力。
 */
export type BatchEnqueueItemResult = {
  ok: boolean
  id?: string
  error?: string
  /** 疑似重复命中的信息；`skipped` / `replaced` 时存在 */
  duplicate?: DuplicateMatch
  /** 本次因疑似重复被跳过（不入库） */
  skipped?: boolean
  /** 本次更新了既有记录并重新下载 */
  replaced?: boolean
}

export type BatchEnqueueResult = {
  total: number
  enqueued: number
  skipped: number
  replaced: number
  ids: string[]
  results: BatchEnqueueItemResult[]
}

/**
 * 批量任务入库：分块事务写入 + 判重。
 *
 * 每个分块内部把「判重查询 + 写入」放进**同一个事务**（D4）：
 * - 保证原子性（并发的另一次入队不会插进查询与写入之间）
 * - 每块只发 1 次判重查询，不产生 N+1
 * - 保留原有 `CHUNK_SIZE` 分块以约束单事务锁占用与 WAL 峰值
 */
export function batchEnqueueDownload(
  items: EnqueueDownloadInput[],
  opts?: { silent?: boolean },
): BatchEnqueueResult {
  if (!items.length) {
    return { total: 0, enqueued: 0, skipped: 0, replaced: 0, ids: [], results: [] }
  }

  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)

  const db = getDb()
  const sourceCache = new Map<string, string | undefined>()
  const getSourceForPlatform = (platform: string) => {
    if (sourceCache.has(platform)) return sourceCache.get(platform)
    const sources = listEnabledOkSources(platform)
    const sid = sources[0]?.id
    sourceCache.set(platform, sid)
    return sid
  }

  const checkDup = settings.duplicateCheckEnabled
  /** 批内自去重：同批次相同 dedupKey 只处理首个（否则本批次会自己撞自己） */
  const batchSeen = new Set<string>()

  const enqueuedIds: string[] = []
  const replacedIds: string[] = []
  const itemResults: BatchEnqueueItemResult[] = new Array(items.length)
  const ts = nowIso()

  const runChunkTransaction = db.transaction((indices: number[]) => {
    // 本分块的 DB 判重结果（同事务内查询，见 D4）
    const dbHits = new Map<number, DuplicateMatch>()
    if (checkDup) {
      const pending = indices.filter((index) => {
        const item = items[index]!
        const key = buildDedupKey(item.artist, item.title)
        return key !== '' && !batchSeen.has(key)
      })
      const hits = findDuplicates(pending.map((index) => duplicateCandidateOf(items[index]!, settings)))
      for (const index of pending) {
        const item = items[index]!
        const hit = hits.get(buildDedupKey(item.artist, item.title))
        if (hit) dbHits.set(index, hit)
      }
    }

    for (const index of indices) {
      const item = items[index]!
      if (item.quality != null && item.quality !== '' && !isAllowedQuality(item.quality)) {
        itemResults[index] = { ok: false, error: `不支持的音质: ${item.quality}` }
        continue
      }

      const key = buildDedupKey(item.artist, item.title)

      // 1) 批内自去重优先：同批次已处理过同 key → 直接跳过（否则本批次会自己撞自己）
      if (checkDup && key && batchSeen.has(key)) {
        itemResults[index] = {
          ok: false,
          skipped: true,
          error: '本批次内重复，已跳过',
          duplicate: { dedupKey: key, reason: 'batch', qualityInverted: false, existing: null },
        }
        continue
      }
      if (checkDup && key) batchSeen.add(key)

      const sourceId = item.sourceId || getSourceForPlatform(item.platform)
      if (!sourceId) {
        itemResults[index] = { ok: false, error: `没有可用音源支持平台 ${item.platform}` }
        continue
      }

      const prepared: PreparedEnqueue = {
        id: randomUUID(),
        ts,
        sourceId,
        quality: item.quality || settings.defaultQuality,
        musicPayload: {
          ...item.musicInfo,
          __downloadLyric: item.downloadLyric ?? settings.downloadLyric,
          __lyricMode: item.lyricMode ?? settings.lyricMode,
          ...(item.folderPrefix ? { __folderPrefix: item.folderPrefix } : {}),
        },
      }

      // 2) 命中历史记录 → 按裁决处理
      const hit = dbHits.get(index)
      if (hit) {
        const action = resolveDuplicateAction(item, undefined, settings)
        if (action === 'enqueue') {
          insertTaskRow(item, prepared)
          enqueuedIds.push(prepared.id)
          itemResults[index] = { ok: true, id: prepared.id, duplicate: hit }
          continue
        }
        if (action === 'replace') {
          // ④A：自动替换同样不得绕过音质保护
          if (hit.qualityInverted) {
            itemResults[index] = {
              ok: false,
              skipped: true,
              error: '音质会降低，已跳过',
              duplicate: hit,
            }
            continue
          }
          const replacedFrom = hit.existing!.id
          updateRowForReplace(replacedFrom, item, prepared, settings)
          replacedIds.push(replacedFrom)
          itemResults[index] = { ok: true, id: replacedFrom, replaced: true, duplicate: hit }
          continue
        }
        itemResults[index] = { ok: false, skipped: true, error: '疑似重复，已跳过', duplicate: hit }
        continue
      }

      // 3) 无重复 → 正常入库
      insertTaskRow(item, prepared)
      enqueuedIds.push(prepared.id)
      itemResults[index] = { ok: true, id: prepared.id }
    }
  })

  // 分块事务提交（每 200 条一次事务），降低单事务锁占用与 WAL 峰值
  const CHUNK_SIZE = 200
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const indices: number[] = []
    for (let j = i; j < Math.min(i + CHUNK_SIZE, items.length); j++) indices.push(j)
    runChunkTransaction(indices)
  }

  if (!opts?.silent) {
    for (const id of enqueuedIds) {
      emitTask(id)
    }
    for (const id of replacedIds) {
      emitTask(id)
    }
  }
  downloadEvents.emit('batch_enqueued', {
    count: enqueuedIds.length,
    ids: enqueuedIds,
    skipped: itemResults.filter((r) => r?.skipped).length,
    replaced: replacedIds.length,
  })
  kickWorker()

  const finalResults = itemResults.map((r) => r ?? { ok: false, error: '未处理' })
  return {
    total: items.length,
    enqueued: enqueuedIds.length,
    skipped: finalResults.filter((r) => r.skipped).length,
    replaced: replacedIds.length,
    ids: enqueuedIds,
    results: finalResults,
  }
}

/**
 * 替换任务被中断（取消 / 失败）时，把记录指回旧文件。
 *
 * 替换是 UPDATE 同一行，`file_path` 在换之前就被置空 —— 若不还原，
 * 旧文件还在磁盘上、记录却说「没有文件」，成为孤儿状态（R-d）。
 */
function restoreReplacePaths(
  task: Pick<DownloadTaskRow, 'music_info_json'>,
): { file_path: string | null; lyric_path: string | null } | null {
  let musicInfo: Record<string, unknown> = {}
  try {
    musicInfo = JSON.parse(task.music_info_json || '{}')
  } catch {
    return null
  }
  const oldFile = typeof musicInfo.__replaceOldFile === 'string' ? musicInfo.__replaceOldFile : null
  const oldLyric = typeof musicInfo.__replaceOldLyric === 'string' ? musicInfo.__replaceOldLyric : null
  if (!oldFile && !oldLyric) return null
  return {
    file_path: oldFile && existsSync(oldFile) ? oldFile : null,
    lyric_path: oldLyric && existsSync(oldLyric) ? oldLyric : null,
  }
}

export function cancelTask(id: string) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  const controller = activeAbortControllers.get(id)
  if (controller) {
    controller.abort()
  }

  // 若刚好已完成：按约定删除成品文件并标为取消
  if (task.status === 'completed') {
    removeTaskFiles(task)
    getDb()
      .prepare(
        `UPDATE download_tasks SET status='cancelled', updated_at=?, error=?, file_path=NULL, lyric_path=NULL, file_size=NULL WHERE id=?`,
      )
      .run(nowIso(), '用户取消（已完成文件已删除）', id)
    emitTask(id)
    return getTask(id)!
  }

  if (task.status === 'queued' || task.status === 'running') {
    removeTaskFiles(task)
    // 替换中的任务：记录指回旧文件（其 file_path 在替换前已置空，旧文件仍在磁盘上）
    const restored = restoreReplacePaths(task)
    getDb()
      .prepare(
        `UPDATE download_tasks SET status='cancelled', updated_at=?, error=?, file_path=?, lyric_path=?, file_size=NULL WHERE id=?`,
      )
      .run(nowIso(), '用户取消', restored?.file_path ?? null, restored?.lyric_path ?? null, id)
  }
  emitTask(id)
  return getTask(id)!
}

/**
 * 按「分类 + 筛选」求任务 id。
 *
 * 与 `/api/downloads` 列表共用同一套条件构造（`buildKeywordClauses` / `buildMetaClauses`），
 * 保证「用户看到的那一批」与「批量操作作用的那一批」严格一致。
 * 不带 filter 时退化为原行为（整个分类），保持向后兼容。
 */
function selectTaskIdsByStatus(statusSql: string, filter?: TaskFilter): string[] {
  const where: string[] = [statusSql]
  const params: unknown[] = []
  if (filter?.playlistUrl) {
    where.push('playlist_url = ?')
    params.push(filter.playlistUrl)
  }
  if (filter?.batchId) {
    where.push('batch_id = ?')
    params.push(filter.batchId)
  }
  const keyword = buildKeywordClauses(filter?.q)
  where.push(...keyword.sql)
  params.push(...keyword.params)
  const meta = buildMetaClauses(filter)
  where.push(...meta.sql)
  params.push(...meta.params)
  const rows = getDb()
    .prepare(`SELECT id FROM download_tasks WHERE ${where.join(' AND ')}`)
    .all(...params) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

export function batchCancelTasks(ids?: string[], opts?: { tab?: 'running'; filter?: TaskFilter }) {
  const targetIds: string[] = []
  if (ids && ids.length > 0) {
    targetIds.push(...ids)
  } else if (opts?.tab === 'running') {
    // 有筛选条件时只取消筛选内的任务，否则「全选」会把筛选外的运行中任务一起干掉
    targetIds.push(...selectTaskIdsByStatus(`status IN ('running', 'queued')`, opts.filter))
  }
  const items = []
  for (const id of targetIds) {
    try {
      items.push(cancelTask(id))
    } catch (e: any) {
      items.push({ id, error: e?.message || String(e) })
    }
  }
  return { count: targetIds.length, items }
}
/** 删除任务记录；可选删除本地音频与歌词 */
export function deleteTask(id: string, opts?: { deleteLocalFiles?: boolean }) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  if (task.status === 'running' || task.status === 'queued') {
    throw createError({ statusCode: 400, statusMessage: '进行中的任务请先取消' })
  }
  if (opts?.deleteLocalFiles) removeTaskFiles(task)
  getDb().prepare(`DELETE FROM download_tasks WHERE id=?`).run(id)
  downloadEvents.emit('task', { ...task, status: 'deleted' })
  return { ok: true, id }
}

export function batchDeleteTasks(ids?: string[], opts?: { deleteLocalFiles?: boolean; tab?: 'completed' | 'failed' }) {
  const targetIds: string[] = []
  if (ids && ids.length > 0) {
    targetIds.push(...ids)
  } else if (opts?.tab === 'completed') {
    const rows = getDb().prepare(`SELECT id FROM download_tasks WHERE status = 'completed'`).all() as Array<{ id: string }>
    targetIds.push(...rows.map((r) => r.id))
  } else if (opts?.tab === 'failed') {
    const rows = getDb().prepare(`SELECT id FROM download_tasks WHERE status IN ('failed', 'cancelled')`).all() as Array<{ id: string }>
    targetIds.push(...rows.map((r) => r.id))
  }
  let deleted = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of targetIds) {
    try {
      deleteTask(id, opts)
      deleted += 1
    } catch (e: any) {
      errors.push({ id, error: e?.message || String(e) })
    }
  }
  return { deleted, errors }
}

/** 失败/取消后整文件重试（不续传） */
export function retryTask(id: string, opts?: { resetAttempts?: boolean; quality?: string }) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  if (task.status === 'running') {
    throw createError({ statusCode: 400, statusMessage: '任务进行中，请先取消再重试' })
  }
  removeTaskFiles(task)
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)

  const quality = opts?.quality?.trim()
  if (quality && !isAllowedQuality(quality)) {
    throw createError({ statusCode: 400, statusMessage: `不支持的音质: ${quality}` })
  }

  getDb()
    .prepare(
      `UPDATE download_tasks SET status='queued', progress=0, error=NULL, file_path=NULL, lyric_path=NULL, file_size=NULL,
       attempts=?, quality=COALESCE(?, quality), updated_at=? WHERE id=?`,
    )
    .run(opts?.resetAttempts ? 0 : task.attempts, quality || null, nowIso(), id)
  emitTask(id)
  kickWorker()
  return getTask(id)!
}

/**
 * 仅更换本任务音质并重新入队；不改全局设置、不记忆默认音质。
 */
export function switchQualityAndRetry(id: string, quality: string) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  if (task.status === 'running' || task.status === 'queued') {
    throw createError({ statusCode: 400, statusMessage: '任务进行中，请先取消再换音质' })
  }
  if (!isAllowedQuality(quality)) {
    throw createError({ statusCode: 400, statusMessage: `不支持的音质: ${quality}` })
  }

  removeTaskFiles(task)
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)

  getDb()
    .prepare(
      `UPDATE download_tasks SET status='queued', progress=0, error=NULL, file_path=NULL, lyric_path=NULL, file_size=NULL,
       quality=?, attempts=0, updated_at=? WHERE id=?`,
    )
    .run(quality, nowIso(), id)
  emitTask(id)
  kickWorker()
  const fresh = getTask(id)!
  return {
    task: fresh,
    previousQuality: task.quality,
    quality,
  }
}

export function batchRetryTasks(ids?: string[], opts?: { resetAttempts?: boolean; tab?: 'failed'; filter?: TaskFilter }) {
  const targetIds: string[] = []
  if (ids && ids.length > 0) {
    targetIds.push(...ids)
  } else if (opts?.tab === 'failed') {
    targetIds.push(...selectTaskIdsByStatus(`status IN ('failed', 'cancelled')`, opts.filter))
  }
  const items = []
  for (const id of targetIds) {
    try {
      items.push(retryTask(id, opts))
    } catch (e: any) {
      items.push({ id, error: e?.message || String(e) })
    }
  }
  kickWorker()
  return { count: targetIds.length, items }
}

function resolveFailedTabTaskIds(ids?: string[], tab?: 'failed', filter?: TaskFilter): string[] {
  if (ids?.length) return ids
  if (tab === 'failed') return selectTaskIdsByStatus(`status IN ('failed', 'cancelled')`, filter)
  return []
}

export function batchSwitchQualityAndRetry(
  ids: string[],
  quality: string,
  opts?: { tab?: 'failed'; filter?: TaskFilter },
) {
  if (!isAllowedQuality(quality)) {
    throw createError({ statusCode: 400, statusMessage: `不支持的音质: ${quality}` })
  }
  const targetIds = ids.length ? ids : resolveFailedTabTaskIds(undefined, opts?.tab, opts?.filter)
  const items = []
  for (const id of targetIds) {
    try {
      items.push(switchQualityAndRetry(id, quality))
    } catch (e: unknown) {
      const err = e as { statusMessage?: string; message?: string }
      items.push({ id, error: err?.statusMessage || err?.message || String(e) })
    }
  }
  kickWorker()
  return { count: targetIds.length, quality, items }
}

/**
 * 失败任务换源重试：切换到指定音源（或同平台可用源中的下一个）并重新入队。
 */
export function switchSourceAndRetry(id: string, opts?: { sourceId?: string }) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  if (task.status === 'running' || task.status === 'queued') {
    throw createError({ statusCode: 400, statusMessage: '任务进行中，请先取消再换源' })
  }

  const available = listEnabledOkSources(task.platform)
  if (!available.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `没有可用音源（平台 ${task.platform}）`,
    })
  }

  let next = opts?.sourceId ? available.find((s) => s.id === opts.sourceId) : undefined
  if (opts?.sourceId && !next) {
    throw createError({
      statusCode: 400,
      statusMessage: '指定音源不可用或不支持该平台',
    })
  }
  if (!next) {
    // 兼容未传 sourceId：排除当前源后轮换
    const alts = available.filter((s) => s.id !== task.source_id)
    next = (alts.length ? alts : available)[0]
  }
  if (!next) {
    throw createError({ statusCode: 400, statusMessage: `没有可用音源（平台 ${task.platform}）` })
  }

  let musicInfo: Record<string, any> = {}
  try {
    musicInfo = JSON.parse(task.music_info_json || '{}')
  } catch {
    musicInfo = {}
  }
  const tried: string[] = Array.isArray(musicInfo.__triedSources)
    ? musicInfo.__triedSources.filter((x: unknown) => typeof x === 'string')
    : []
  if (task.source_id && !tried.includes(task.source_id)) tried.push(task.source_id)
  const nextTried = [...new Set([...tried, next.id])]

  removeTaskFiles(task)
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)

  getDb()
    .prepare(
      `UPDATE download_tasks SET status='queued', progress=0, error=NULL, file_path=NULL, lyric_path=NULL, file_size=NULL,
       source_id=?, attempts=0, music_info_json=?, updated_at=? WHERE id=?`,
    )
    .run(
      next.id,
      JSON.stringify({ ...musicInfo, __triedSources: nextTried }),
      nowIso(),
      id,
    )
  emitTask(id)
  kickWorker()
  const fresh = getTask(id)!
  return {
    task: fresh,
    previousSourceId: task.source_id,
    sourceId: next.id,
    sourceName: next.name,
  }
}

/** 批量换源：可统一 sourceId，或按任务指定 sourceById；支持 allWithTab=failed 全选 */
export function batchSwitchSourceAndRetry(
  ids: string[],
  opts?: { sourceId?: string; sourceById?: Record<string, string>; tab?: 'failed'; filter?: TaskFilter },
) {
  const targetIds = ids.length ? ids : resolveFailedTabTaskIds(undefined, opts?.tab, opts?.filter)
  const items = []
  for (const id of targetIds) {
    try {
      const sourceId = opts?.sourceById?.[id] || opts?.sourceId
      items.push(switchSourceAndRetry(id, sourceId ? { sourceId } : undefined))
    } catch (e: unknown) {
      const err = e as { statusMessage?: string; message?: string }
      items.push({ id, error: err?.statusMessage || err?.message || String(e) })
    }
  }
  kickWorker()
  return { count: targetIds.length, items }
}

const lastEmitTimeByTaskId = new Map<string, number>()
const lastEmitProgressByTaskId = new Map<string, number>()

function updateTask(
  id: string,
  patch: Partial<DownloadTaskRow>,
  opts?: { throttleProgress?: boolean; whereStatus?: string[] },
) {
  const keys = Object.keys(patch)
  if (!keys.length) return 0
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  let sql = `UPDATE download_tasks SET ${sets}, updated_at = ? WHERE id = ?`
  const runArgs: unknown[] = [...keys.map((k) => (patch as Record<string, unknown>)[k]), nowIso(), id]
  if (opts?.whereStatus?.length) {
    sql += ` AND status IN (${opts.whereStatus.map(() => '?').join(',')})`
    runArgs.push(...opts.whereStatus)
  }
  const info = getDb().prepare(sql).run(...runArgs)
  // CAS 未命中（如任务已被取消/删除）：不广播事件，避免复活脏数据
  if (info.changes === 0) return 0

  if (opts?.throttleProgress && patch.progress != null) {
    const now = Date.now()
    const lastTime = lastEmitTimeByTaskId.get(id) || 0
    const lastProg = lastEmitProgressByTaskId.get(id) ?? -1
    const progDiff = Math.abs(patch.progress - lastProg)
    if (now - lastTime < 250 && progDiff < 0.05 && patch.progress < 0.99) {
      return info.changes
    }
    lastEmitTimeByTaskId.set(id, now)
    lastEmitProgressByTaskId.set(id, patch.progress)
  } else {
    lastEmitTimeByTaskId.delete(id)
    lastEmitProgressByTaskId.delete(id)
  }
  emitTask(id)
  return info.changes
}

/**
 * 状态迁移原语（CAS）：仅当任务当前状态 ∈ fromStatuses 时应用 patch。
 * 保证 cancelled 为终结态 —— worker 侧任何状态回写都不得复活已取消任务。
 */
export function applyStatusTransition(
  id: string,
  patch: Partial<DownloadTaskRow>,
  fromStatuses: string[],
): boolean {
  return updateTask(id, patch, { whereStatus: fromStatuses }) > 0
}
export function ensureDiskWritable(dir: string) {
  return assertDownloadDirWritable(dir)
}

/**
 * 一次 worker 尝试内探索「音源 × 音质」组合的上限（兜底，防极端音源数下空转）。
 *
 * 取链层按「音质档位在外、音源在内」的顺序遍历，所以**前 N 次探测天然覆盖
 * "每个音源各试一次它的最高档"** —— 这正是"换个音源也许有完整文件"最该验证的一轮。
 * 因此实际预算取音源数：一轮走完仍全是试听，就如实报错，
 * 剩下的低档位留给用户手动「重试」（排除集已持久化，重试会接着往下走）。
 */
const PREVIEW_COMBO_CAP = 20

/** 达到该实测码率即视为真 Hi-Res —— 已无更好选择，提前收工 */
const HIRES_KBPS = 1500

/** 攒够这么多个「合格」候选就收工；排序仍会从中挑码率最大的 */
const PROBE_OK_ENOUGH = 3

/** 记录「已确认不可用」的组合（试听 / 谎报），让手动重试能从断点继续而不是重头再来 */
function persistPreviewBlocked(
  taskId: string,
  musicInfo: Record<string, unknown>,
  blocked: ReadonlySet<string>,
) {
  if (!blocked.size) return
  updateTask(taskId, {
    music_info_json: JSON.stringify({ ...musicInfo, __previewBlocked: [...blocked] }),
  })
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress: (p: number, received: number, total: number) => void,
  signal?: AbortSignal,
  opts?: { expectedDurationSec?: number | null; quality?: string | null },
) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'miyin/0.1', Referer: 'https://www.google.com/' },
    signal,
  })
  if (!res.ok || !res.body) {
    const err = new Error(`下载 HTTP ${res.status}`)
    const status = res.status
    const isRetry = status >= 500 || status === 429
    Object.assign(err, { code: isRetry ? 'HTTP_RETRY' : 'HTTP_FATAL' })
    throw err
  }
  const total = Number(res.headers.get('content-length') || 0)
  const expected = opts?.expectedDurationSec
  if (total > 0 && expected && expected >= 90) {
    const minBytes = minFullTrackBytes(expected, opts?.quality)
    if (total < minBytes) {
      // 预检在读 body **之前**触发：代价仅是一次请求头，所以调用方可以放心多试几个组合。
      // 显式取消 body，避免留下悬挂连接
      await res.body.cancel().catch(() => {})
      throw previewSizeError(total, expected)
    }
  }
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  const out = createWriteStream(dest, { highWaterMark: 64 * 1024 })
  try {
    nodeStream.on('data', (chunk: Buffer) => {
      if (signal?.aborted) {
        nodeStream.destroy(new Error('cancelled'))
        return
      }
      received += chunk.length
      if (total > 0) onProgress(Math.min(0.99, received / total), received, total)
      else onProgress(Math.min(0.95, received / (received + 1024 * 1024)), received, 0)
    })
    await pipeline(nodeStream, out, { signal })
    onProgress(1, received, total || received)
    return { received, total: total || received }
  } catch (err: unknown) {
    try {
      out.close()
      if (existsSync(dest)) unlinkSync(dest)
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    nodeStream.removeAllListeners()
  }
}

async function processTask(task: DownloadTaskRow) {
  const abortController = new AbortController()
  activeAbortControllers.set(task.id, abortController)
  activeProcessingTasks.add(task.id)

  /** 最终落盘路径（下载校验通过后才存在） */
  let filePath: string | null = null
  let lyricPath: string | null = null
  /** 临时路径：失败 / 取消时只需清理它们，最终路径上的既有文件不受影响 */
  let tempPath: string | null = null
  let lyricTempPath: string | null = null
  /** 是否已提交落盘（rename 之后）。提交前失败绝不触碰既有文件 */
  let committed = false
  const settings = getSettings()
  try {
    const current = getTask(task.id)
    if (!current || current.status === 'cancelled' || abortController.signal.aborted) {
      return
    }
    // CAS：仅 queued → running。若已被取消（CAS 失败）则直接退出，不复活任务
    const started = applyStatusTransition(task.id, { status: 'running', progress: 0.01, error: null }, ['queued'])
    if (!started) return
    ensureDownloadDirWritable(settings.downloadDir)
    const musicInfo = JSON.parse(task.music_info_json || '{}') as Record<string, unknown>
    const expectedDuration = expectedDurationFromMusicInfo(musicInfo)

    const dir = getDownloadDir(settings.downloadDir)
    const trackNo = (musicInfo.track || musicInfo.trackNo || musicInfo.tracknum || musicInfo.no) as string | number | undefined
    const folderPrefix =
      typeof musicInfo.__folderPrefix === 'string' ? musicInfo.__folderPrefix : null
    const qualityPref = task.quality || settings.defaultQuality

    /**
     * 已确认不可用而需要跳过的 `sourceId@quality` 组合（试听 / 谎报档位）。
     *
     * 取链成功**不代表内容正确** —— 会员曲目能取到链接但内容是 60s 试听，
     * 也有音源把 320k mp3 标成 flac24bit。这些都只有拿到响应头/文件才暴露，
     * 所以把结论回灌给取链层，避免下次又选中同一条"看起来成功"的路。
     */
    const previewBlocked = new Set<string>(
      Array.isArray(musicInfo.__previewBlocked) ? (musicInfo.__previewBlocked as string[]) : [],
    )
    /** 本次尝试新排除了几个组合 —— 只在有新增时才写回，避免每次下载都白写一次 */
    const blockedAtStart = previewBlocked.size
    // 探测预算 = 音源数（覆盖"每个音源试它的最高档"一整轮），并有上限兜底
    const probeBudget = Math.min(
      Math.max(listEnabledOkSources(task.platform).length, 4),
      PREVIEW_COMBO_CAP,
    )

    let quality = qualityPref
    let fileSize: number | null = null
    let base = ''
    let plannedPath = ''
    let temp = ''
    let downloaded = false

    // ── 阶段 1：收集候选并探测（每个候选只读响应头，不下载内容）──
    type Candidate = {
      url: string
      quality: string
      sourceId: string
      sourceName: string
      estKbps: number | null
      verdict: CandidateVerdict
    }
    const candidates: Candidate[] = []
    let okCount = 0

    // 列举与探测交织：候选一到手就立刻探测，满足收工条件即停止列举 ——
    // 否则 15 个音源全探一遍会让每首歌多花十几秒
    const listed = await listMusicUrlCandidates({
      platform: task.platform,
      musicInfo,
      quality: qualityPref,
      sourceId: task.source_id,
      exclude: previewBlocked,
      limit: probeBudget,
      onCandidate: async (cand) => {
        if (abortController.signal.aborted) return false
        const key = `${cand.sourceId}@${cand.quality}`
        if (isLikelyPreviewUrl(cand.url)) {
          previewBlocked.add(key)
          return
        }
        const probe = await probeCandidate(cand.url, {
          expectedDurationSec: expectedDuration,
          quality: cand.quality,
          signal: abortController.signal,
        })
        if (probe.verdict === 'preview') {
          previewBlocked.add(key)
          recordSourceOutcome({
            sourceId: cand.sourceId,
            platform: task.platform,
            outcome: 'preview',
          })
          console.warn(`[download] ${task.title}: ${key} ${probe.reason} → 排除`)
          return
        }
        if (probe.verdict === 'error') {
          console.warn(`[download] ${task.title}: ${key} 探测失败（${probe.reason}）→ 跳过`)
          return
        }
        candidates.push({ ...cand, estKbps: probe.estKbps, verdict: probe.verdict })
        if (probe.verdict === 'ok') okCount++
        // 已是真 Hi-Res：但至少留一个对照候选再收工 ——
        // 否则这条"看起来是 Hi-Res"的路一旦是谎报（L2 才识破），本轮到这就没牌可打了
        if (
          probe.verdict === 'ok' &&
          (probe.estKbps ?? 0) >= HIRES_KBPS &&
          candidates.length >= 2
        ) {
          return false
        }
        // 已攒够足够多的合格候选 → 收工（下面的排序仍会从中挑最大的）
        if (okCount >= PROBE_OK_ENOUGH) return false
      },
    })

    if (!candidates.length) {
      if (previewBlocked.size > 0) {
        persistPreviewBlocked(task.id, musicInfo, previewBlocked)
        // 还有没探查过的组合时才说"重试可继续"，否则如实告知可能需会员
        throw allPreviewError(previewBlocked.size, listed.truncated)
      }
      const detail = listed.errors.slice(0, 12).join(' | ') || '无详细错误'
      throw Object.assign(
        new Error(
          isHighestQuality(qualityPref)
            ? `取链失败（已轮询 ${listed.loadedCount} 个音源并尝试降级）：${detail}`
            : `取链失败（已轮询 ${listed.loadedCount} 个音源）：${detail}`,
        ),
        { code: 'GET_URL_FAILED' },
      )
    }

    /**
     * **按实测码率择优** —— 声称的档位不可信：
     * 实测里 `Hei Music` 声称 flac24bit 只有 321kbps，而 `念心音源` 声称 flac 有 933kbps。
     * 若按声称档位排，谎报的那个会排在真无损前面 —— 正是本次要修的问题。
     * 探测不到码率的（`unknown`）排最后，作为兜底候选。
     */
    candidates.sort((a, b) => (b.estKbps ?? -1) - (a.estKbps ?? -1))

    console.warn(
      `[download] ${task.title}: 候选 ${candidates.length} 个 → ` +
        candidates
          .map((c) => `${c.sourceId.slice(0, 8)}@${c.quality}(${c.estKbps ? Math.round(c.estKbps) + 'k' : '未知'})`)
          .join(' > '),
    )

    /**
     * 按给定档位算落点。抽成闭包是因为 L3 可能在下载后修正档位 ——
     * 那时要按真实档位重算一次，否则会出现「文件名里写 flac24bit、记录写 flac」的不一致。
     */
    const resolvePaths = (q: string, url: string) => {
      const b = buildDownloadRelativeBase(
        settings.nameTemplate,
        {
          artist: task.artist,
          title: task.title,
          album: task.album || undefined,
          platform: task.platform,
          quality: q,
          id: task.external_id || undefined,
          track: trackNo,
        },
        folderPrefix,
      )
      const e = guessExt(url, q)
      return { base: b, ext: e, plannedPath: joinDownloadRelative(dir, b, e) }
    }

    // ── 阶段 2：按序下载，首个通过全部校验者胜出 ──
    for (const cand of candidates) {
      if (abortController.signal.aborted) throw new Error('cancelled')
      // 档位与实测不符时（兜底候选），按实测码率反推真实档位写回，别沿用谎报值
      quality =
        cand.verdict === 'ok' || cand.estKbps == null
          ? cand.quality
          : qualityFromBitrate(cand.estKbps)
      const key = `${cand.sourceId}@${cand.quality}`

      const paths = resolvePaths(quality, cand.url)
      base = paths.base
      // 计划落点：扩展名先按 URL / 音质猜，下载完成后再以魔数纠正
      plannedPath = paths.plannedPath
      filePath = plannedPath
      temp = joinDownloadRelative(dir, `${base}${TEMP_SUFFIX}`, paths.ext)
      tempPath = temp
      ensureParentDir(temp)

      try {
        await downloadFile(
          cand.url,
          temp,
          (p, received, total) =>
            updateTask(
              task.id,
              {
                progress: p,
                quality,
                file_size: total > 0 ? total : received || null,
              },
              { throttleProgress: true },
            ),
          abortController.signal,
          { expectedDurationSec: expectedDuration, quality },
        )

        if (abortController.signal.aborted) throw new Error('cancelled')

        try {
          fileSize = statSync(temp).size
        } catch {
          fileSize = null
        }

        // L2 兜底：声称无损但实际是 mp3（L1 拿不到 Content-Length 时靠这一步识破）
        const sniffed = sniffAudioExt(temp)
        if (isLosslessClaimMismatch(cand.quality, sniffed)) {
          const err = new Error(
            `音源声称 ${cand.quality}，实际是 ${sniffed}（${cand.sourceId.slice(0, 8)}）`,
          ) as Error & { code?: string }
          err.code = 'QUALITY_MISMATCH'
          throw err
        }

        // 试听检测 + L3：一次 ffprobe 同时拿时长与真实参数（位深/采样率/声道），不额外 spawn
        const info = await probeAudioInfo(temp)
        const actual = info?.durationSec ?? null
        if (actual != null) {
          if (expectedDuration && expectedDuration > 0 && isLikelyPreviewClip(actual, expectedDuration)) {
            throw previewClipError(actual, expectedDuration)
          }
          if (
            !(expectedDuration && expectedDuration > 0) &&
            isLikelyPreviewByAbsoluteDuration(actual, fileSize)
          ) {
            throw previewClipError(actual, null)
          }
        }

        // L3：用实测位深修正**记录的档位**（不拒绝文件 —— 只剩 16bit 时硬拒会什么都下不到）
        const corrected = correctedQualityFromProbe(quality, info) ?? quality
        if (corrected !== quality) {
          console.warn(
            `[download] ${task.title}: 实测 ${info?.bitsPerRawSample ?? '?'}bit/` +
              `${info?.sampleRate ?? '?'}Hz/${info?.channels ?? '?'}声道，` +
              `配不上声称的 ${quality} → 记录档位修正为 ${corrected}`,
          )
          quality = corrected
          // 落点里的 {quality} 也要跟着改，否则文件名与记录会互相矛盾
          // （临时文件的名字不动 —— 提交时是 rename 到新 plannedPath，tempPath 只作来源）
          const fixed = resolvePaths(quality, cand.url)
          base = fixed.base
          plannedPath = fixed.plannedPath
          filePath = plannedPath
        }
      } catch (err: unknown) {
        const code = String((err as { code?: string })?.code)
        if (code !== 'PREVIEW_CLIP' && code !== 'QUALITY_MISMATCH') throw err
        previewBlocked.add(key)
        recordSourceOutcome({
          sourceId: cand.sourceId,
          platform: task.platform,
          outcome: code === 'QUALITY_MISMATCH' ? 'quality-lie' : 'preview',
        })
        removeFileQuiet(temp)
        tempPath = null
        filePath = null
        console.warn(
          `[download] ${task.title}: ${(err as Error).message} → 排除 ${key}，换下一个候选`,
        )
        continue
      }
      // 记录实际交付的音源：后续重试可优先复用，也是音源评分的依据
      if (cand.sourceId !== task.source_id) {
        updateTask(task.id, { source_id: cand.sourceId })
        task.source_id = cand.sourceId
      }
      recordSourceOutcome({
        sourceId: cand.sourceId,
        platform: task.platform,
        outcome: 'success',
        kbps: cand.estKbps,
      })
      downloaded = true
      break
    }

    if (!downloaded) {
      // 把已排除的组合持久化，手动重试可以从断点继续而不是重头再来
      persistPreviewBlocked(task.id, musicInfo, previewBlocked)
      throw allPreviewError(previewBlocked.size, listed.truncated)
    }

    // 刻意**不**清除排除集：它是"哪些路走过不通"的学习结果。
    // 保留后，替换/重下同一首时会直接跳开谎报与试听的音源，而不是重新踩一遍。
    if (previewBlocked.size > blockedAtStart) {
      persistPreviewBlocked(task.id, musicInfo, previewBlocked)
    }

    const downloadLyric =
      typeof musicInfo.__downloadLyric === 'boolean' ? musicInfo.__downloadLyric : settings.downloadLyric
    const lyricMode =
      musicInfo.__lyricMode === 'embedded' || musicInfo.__lyricMode === 'external'
        ? musicInfo.__lyricMode
        : settings.lyricMode

    let lrcText: string | null = null
    if (downloadLyric) {
      try {
        lrcText = await fetchLyric(task.platform, musicInfo)
      } catch {
        lrcText = null
      }
    }

    // 歌词也先落临时文件，与音频一并在提交阶段 rename —— 否则替换时会提前删掉旧歌词
    let lyricTemp: string | null = null
    if (lrcText && lyricMode === 'external') {
      lyricPath = joinDownloadRelative(dir, base, 'lrc')
      lyricTemp = joinDownloadRelative(dir, `${base}${TEMP_SUFFIX}`, 'lrc')
      lyricTempPath = lyricTemp
      ensureParentDir(lyricTemp)
      writeFileSync(lyricTemp, lrcText, 'utf8')
    }

    // 元数据：基础字段 + 封面 +（仅内嵌模式）歌词（仍作用于临时文件）
    const metaResult = await writeAudioMetadata(
      temp,
      {
        title: task.title,
        artist: task.artist,
        album: task.album,
        platform: task.platform,
        quality,
        external_id: task.external_id,
      },
      musicInfo,
      lyricMode === 'embedded' ? lrcText : null,
    )
    if (!metaResult.ok && metaResult.reason) {
      console.warn('[download] metadata:', metaResult.reason)
    }

    // 取消竞态：提交前发现已取消 → 只清临时文件，最终路径上的既有文件不受影响
    if (abortController.signal.aborted) throw new Error('cancelled')

    // 提交：原子 rename 到最终路径。**此刻起**才可能覆盖既有文件（D6-A 的核心保证）
    filePath = commitDownloadedFile(temp, base, dir, plannedPath)
    if (lyricTemp && lyricPath) {
      ensureParentDir(lyricPath)
      renameSync(lyricTemp, lyricPath)
      lyricTempPath = null
    }
    committed = true
    tempPath = null

    // CAS：仅 running → completed。未命中说明任务已被取消，清理本地文件并保留取消态
    const completed = applyStatusTransition(
      task.id,
      {
        status: 'completed',
        progress: 1,
        file_path: filePath,
        lyric_path: lyricPath,
        quality,
        file_size: fileSize,
        error: null,
      },
      ['running'],
    )
    if (completed) {
      // 替换任务：旧文件留到新文件完全落地后才删（R-d）
      cleanupReplacedFiles(task)
    } else {
      removeFileQuiet(filePath)
      removeFileQuiet(lyricPath)
      committed = false
    }
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; name?: string }
    let msg = e?.message || String(err)
    if (isDownloadPermissionError(err) && !/无下载目录写入权限/.test(msg)) {
      msg = `无下载目录写入权限: ${settings.downloadDir}`
      Object.assign(err as object, { code: 'EACCES' })
    }
    // 未提交：只清临时产物 → 最终路径上的既有文件（含被替换的旧文件）完整保留（D6-A / R-d）
    removeFileQuiet(tempPath)
    removeFileQuiet(lyricTempPath)
    if (committed) {
      removeFileQuiet(filePath)
      removeFileQuiet(lyricPath)
      committed = false
    }
    // 替换任务中断时把记录指回旧文件，避免"旧文件还在、记录却说没有"
    const restored = restoreReplacePaths(task)
    if (msg === 'cancelled' || abortController.signal.aborted || e?.name === 'AbortError') {
      applyStatusTransition(
        task.id,
        {
          status: 'cancelled',
          error: '用户取消',
          file_path: restored?.file_path ?? null,
          lyric_path: restored?.lyric_path ?? null,
          file_size: null,
        },
        ['queued', 'running'],
      )
      return
    }
    const attempts = (task.attempts || 0) + 1
    const settings2 = getSettings()
    const qualityPref = task.quality || settings2.defaultQuality
    const fixedQuality = !isHighestQuality(qualityPref)
    /**
     * 试听片段**可以**自动进入下一轮。
     *
     * 早期实现把它当作终结态（"只标失败，由用户手动换源"），前提是"试听 ⇒ 该曲目在哪都下不到"
     * —— 这个前提是错的：不同音源走的接口与账号不同，A 源只给试听、B 源可能是完整文件。
     * 而且 `highest` 的定义就是「多源轮询 + 降级」，遇到试听就停等于放弃降级。
     *
     * 单轮已在上面的组合循环里探完一整轮音源（每源试它的最高档）；
     * 这里让它回队列进入下一轮 = 继续降档。排除集已持久化在任务上，不会重复探同一组合。
     * 轮次由 `maxAttempts` 约束，不会无限空转。
     */
    const isPreview = String(e?.code) === 'PREVIEW_CLIP'
    const isPerm = isDownloadPermissionError(err)
    // 固定音质：resolve 已轮询全部音源；失败即停并提示原因
    const retryable = isPerm
      ? false
      : isPreview
        ? true
        : fixedQuality
          ? isRetryableError(err) || String(e?.code) === 'HTTP_RETRY'
          : isRetryableError(err) ||
            String(e?.code) === 'HTTP_RETRY' ||
            String(e?.code) === 'GET_URL_FAILED'
    const alts = fixedQuality
      ? []
      : listEnabledOkSources(task.platform).filter((s) => s.id !== task.source_id)
    const nextStatus = nextStatusAfterFailure({
      attempts,
      maxAttempts: settings2.maxAttempts,
      autoFailover: settings2.autoFailover,
      hasAltSource: alts.length > 0,
      retryable,
    })
    if (nextStatus === 'queued') {
      const next = alts.length ? alts[(attempts - 1) % alts.length] : null
      applyStatusTransition(
        task.id,
        {
          status: 'queued',
          attempts,
          source_id: next?.id || task.source_id,
          error: `失败重试(${attempts}/${settings2.maxAttempts}): ${msg}`,
          progress: 0,
          file_path: restored?.file_path ?? null,
          lyric_path: restored?.lyric_path ?? null,
          file_size: null,
        },
        ['running'],
      )
      setTimeout(() => kickWorker(), 500)
    } else {
      applyStatusTransition(
        task.id,
        {
          status: 'failed',
          attempts,
          error: msg,
          progress: 0,
          file_path: restored?.file_path ?? null,
          lyric_path: restored?.lyric_path ?? null,
          file_size: null,
        },
        ['running'],
      )
    }
  } finally {
    inFlightQueueTaskIds.delete(task.id)
    activeAbortControllers.delete(task.id)
    activeProcessingTasks.delete(task.id)
    lastEmitTimeByTaskId.delete(task.id)
    lastEmitProgressByTaskId.delete(task.id)
  }
}

function guessExt(url: string, quality: string) {
  const u = url.toLowerCase()
  // 优先看明确后缀；quality=flac 仅作弱提示（下载后会再嗅探纠正）
  if (/\.flac(?:\?|#|$)/i.test(u) || quality === 'flac' || quality === 'flac24bit') return 'flac'
  if (/\.m4a(?:\?|#|$)/i.test(u)) return 'm4a'
  if (/\.ape(?:\?|#|$)/i.test(u)) return 'ape'
  if (/\.ogg(?:\?|#|$)/i.test(u)) return 'ogg'
  if (/\.wav(?:\?|#|$)/i.test(u)) return 'wav'
  if (/\.mp3(?:\?|#|$)/i.test(u)) return 'mp3'
  return 'mp3'
}

/**
 * 把临时文件落到最终路径：按魔数纠正扩展名后**原子 rename**。
 *
 * D6-A：这是"下载成功才覆盖既有文件"的唯一落点 —— 失败 / 取消时旧文件原样保留。
 * 扩展名纠正不再需要预先 `unlink` 目标（rename 本身原子覆盖）。
 */
function commitDownloadedFile(
  tempPath: string,
  base: string,
  dir: string,
  plannedPath: string,
): string {
  const sniffed = sniffAudioExt(tempPath)
  const plannedExt = plannedPath.includes('.') ? plannedPath.split('.').pop()!.toLowerCase() : ''
  let finalPath = plannedPath
  if (sniffed && sniffed !== plannedExt) {
    // 避免「标称 flac、实为 mp3」导致元数据写入失败
    finalPath = joinDownloadRelative(dir, base, sniffed)
    console.warn(`[download] 扩展名已纠正: .${plannedExt || '?'} → .${sniffed}`)
  }
  ensureParentDir(finalPath)
  renameSync(tempPath, finalPath)
  return finalPath
}

export async function tickWorker() {
  if (isTicking) return
  isTicking = true
  try {
    const settings = getSettings()
    const queue = getOrCreateDownloadQueue(settings.concurrency)
    const availableSlots = settings.concurrency - (queue.pending + queue.size)
    if (availableSlots <= 0) return

    for (let i = 0; i < availableSlots; i++) {
      const waitMs = msUntilCanStartTask({
        now: Date.now(),
        lastStartedAt,
        lastFinishedAt,
        taskStartIntervalSec: settings.taskStartIntervalSec,
        downloadIntervalSec: settings.downloadIntervalSec,
      })
      if (waitMs > 0) {
        scheduleKickAfter(waitMs)
        break
      }

      const placeholders = Array.from(inFlightQueueTaskIds).map(() => '?').join(',')
      const notInClause = inFlightQueueTaskIds.size > 0 ? `AND id NOT IN (${placeholders})` : ''
      const next = getDb()
        .prepare(`SELECT * FROM download_tasks WHERE status = 'queued' ${notInClause} ORDER BY created_at ASC LIMIT 1`)
        .get(...Array.from(inFlightQueueTaskIds)) as DownloadTaskRow | undefined
      if (!next) break

      inFlightQueueTaskIds.add(next.id)
      lastStartedAt = Date.now()
      void queue.add(async () => {
        try {
          await processTask(next)
        } finally {
          inFlightQueueTaskIds.delete(next.id)
          lastFinishedAt = Date.now()
          if (activeProcessingTasks.size === 0) {
            scheduleIdleShrinkDb()
          }
          kickWorker()
        }
      })
    }
    if (availableSlots > 0 && activeProcessingTasks.size === 0 && (!downloadQueue || downloadQueue.pending === 0)) {
      scheduleIdleShrinkDb()
    }
  } finally {
    isTicking = false
  }
}

export function kickWorker() {
  void tickWorker()
}

export function startDownloadWorker() {
  // 服务启动或重启时，重置非活跃的孤儿 running 任务回 queued，防止重启残留导致假运行
  try {
    getDb()
      .prepare(
        `UPDATE download_tasks SET status = 'queued', progress = 0, updated_at = ? WHERE status = 'running'`,
      )
      .run(nowIso())
  } catch (e) {
    console.warn('[downloadQueue] 重置启动前 running 任务失败:', e)
  }

  if (loopTimer) return
  loopTimer = setInterval(() => {
    void tickWorker()
  }, 8000)
  void tickWorker()
}
