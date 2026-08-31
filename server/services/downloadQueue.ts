import { EventEmitter } from 'node:events'
import {
  createWriteStream,
  unlinkSync,
  existsSync,
  statSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import PQueue from 'p-queue'
import { getDb } from '../utils/db'
import { getDownloadDir } from '../utils/paths'
import {
  assertDownloadDirWritable,
  ensureDownloadDirWritable,
  isDownloadPermissionError,
} from '../utils/downloadDir'
import { getSettings } from './settingsService'
import { listEnabledOkSources } from './sourceRegistry'
import { isHighestQuality, resolveMusicUrl } from './musicUrlResolve'
import { fetchLyric } from './lyricService'
import { writeAudioMetadata } from './metadataService'
import { sniffAudioExt } from '../utils/audioSniff'
import {
  expectedDurationFromMusicInfo,
  isLikelyPreviewByAbsoluteDuration,
  isLikelyPreviewClip,
  isLikelyPreviewUrl,
  minFullTrackBytes,
  previewClipError,
  previewSizeError,
  previewUrlError,
  probeAudioDurationSeconds,
} from '../utils/audioPreview'
import { nextStatusAfterFailure, isRetryableError } from './downloadState'
import { msUntilCanStartTask } from '../utils/downloadIntervals'
export type { TaskStatus } from './downloadState'
export { nextStatusAfterFailure, isRetryableError } from './downloadState'

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
const activeAbortControllers = new Map<string, AbortController>()
const activeProcessingTasks = new Set<string>()

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

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unknown'
}

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
  return sanitizeFilename(
    template
      .replaceAll('{artist}', meta.artist || '未知')
      .replaceAll('{title}', meta.title || '未知')
      .replaceAll('{album}', meta.album || '')
      .replaceAll('{platform}', meta.platform || '')
      .replaceAll('{quality}', meta.quality || '')
      .replaceAll('{id}', meta.id || '')
      .replaceAll('{track}', meta.track != null ? String(meta.track) : ''),
  )
}

export type ListTasksQuery = {
  status?: string
  statuses?: string[]
  tab?: 'running' | 'completed' | 'failed'
  playlistUrl?: string
  batchId?: string
  page?: number
  pageSize?: number
  limit?: number
}

export function listTasks(queryOrStatus?: string | ListTasksQuery) {
  if (typeof queryOrStatus === 'string') {
    return getDb()
      .prepare('SELECT * FROM download_tasks WHERE status = ? ORDER BY created_at DESC')
      .all(queryOrStatus) as DownloadTaskRow[]
  }
  const q = queryOrStatus || {}
  const whereClauses: string[] = []
  const params: unknown[] = []

  if (q.tab) {
    if (q.tab === 'running') {
      whereClauses.push(`status IN ('running', 'queued')`)
    } else if (q.tab === 'completed') {
      whereClauses.push(`status = 'completed'`)
    } else if (q.tab === 'failed') {
      whereClauses.push(`status IN ('failed', 'cancelled')`)
    }
  } else if (q.statuses && q.statuses.length > 0) {
    const placeholders = q.statuses.map(() => '?').join(',')
    whereClauses.push(`status IN (${placeholders})`)
    params.push(...q.statuses)
  } else if (q.status) {
    whereClauses.push('status = ?')
    params.push(q.status)
  }

  if (q.playlistUrl) {
    whereClauses.push('playlist_url = ?')
    params.push(q.playlistUrl)
  }
  if (q.batchId) {
    whereClauses.push('batch_id = ?')
    params.push(q.batchId)
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  let orderBySql = 'ORDER BY created_at DESC'
  if (q.tab === 'running') {
    // 下载中（running）排在最前，排队中（queued）按入队先后顺序排列
    orderBySql = `ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END ASC, created_at ASC`
  } else if (q.tab === 'completed') {
    orderBySql = `ORDER BY updated_at DESC, created_at DESC`
  }

  const page = q.page && q.page > 0 ? q.page : undefined
  const pageSize = q.pageSize && q.pageSize > 0 ? Math.min(q.pageSize, 1000) : undefined

  if (page && pageSize) {
    const offset = (page - 1) * pageSize
    return getDb()
      .prepare(`SELECT * FROM download_tasks ${whereSql} ${orderBySql} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset) as DownloadTaskRow[]
  }

  const limit = q.limit && q.limit > 0 ? q.limit : 200
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

export function getTaskStats(filter?: { playlistUrl?: string; batchId?: string }): TaskStats {
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
  batchId?: string
  playlistUrl?: string
}

export function enqueueDownload(input: EnqueueDownloadInput) {
  const settings = getSettings()
  assertDownloadDirWritable(settings.downloadDir)

  const id = randomUUID()
  const ts = nowIso()
  const sources = listEnabledOkSources(input.platform)
  const sourceId = input.sourceId || sources[0]?.id
  if (!sourceId) {
    throw createError({ statusCode: 400, statusMessage: `没有可用音源支持平台 ${input.platform}` })
  }

  const musicPayload = {
    ...input.musicInfo,
    __downloadLyric: input.downloadLyric ?? settings.downloadLyric,
    __lyricMode: input.lyricMode ?? settings.lyricMode,
  }

  getDb()
    .prepare(
      `INSERT INTO download_tasks (
        id, title, artist, album, platform, source_id, quality, status, progress,
        external_id, match_method, batch_id, playlist_url, music_info_json, file_size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.title,
      input.artist,
      input.album || null,
      input.platform,
      sourceId,
      input.quality || settings.defaultQuality,
      input.externalId || null,
      input.matchMethod || 'id',
      input.batchId || null,
      input.playlistUrl || null,
      JSON.stringify(musicPayload),
      ts,
      ts,
    )
  emitTask(id)
  kickWorker()
  return getTask(id)!
}

/**
 * 批量任务入库：使用 SQLite 事务进行高效分批写入，避免循环单个 insert 导致的 WAL 和事件广播压力。
 */
export function batchEnqueueDownload(
  items: EnqueueDownloadInput[],
  opts?: { silent?: boolean },
): { total: number; enqueued: number; ids: string[] } {
  if (!items.length) return { total: 0, enqueued: 0, ids: [] }

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

  const insertStmt = db.prepare(
    `INSERT INTO download_tasks (
      id, title, artist, album, platform, source_id, quality, status, progress,
      external_id, match_method, batch_id, playlist_url, music_info_json, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )

  const enqueuedIds: string[] = []
  const ts = nowIso()

  const runInsertTransaction = db.transaction((taskList: EnqueueDownloadInput[]) => {
    for (const item of taskList) {
      const sourceId = item.sourceId || getSourceForPlatform(item.platform)
      if (!sourceId) continue

      const id = randomUUID()
      const musicPayload = {
        ...item.musicInfo,
        __downloadLyric: item.downloadLyric ?? settings.downloadLyric,
        __lyricMode: item.lyricMode ?? settings.lyricMode,
      }

      insertStmt.run(
        id,
        item.title,
        item.artist,
        item.album || null,
        item.platform,
        sourceId,
        item.quality || settings.defaultQuality,
        item.externalId || null,
        item.matchMethod || 'id',
        item.batchId || null,
        item.playlistUrl || null,
        JSON.stringify(musicPayload),
        ts,
        ts,
      )
      enqueuedIds.push(id)
    }
  })

  // 分块事务提交（每 200 条一次事务），降低单事务锁占用与 WAL 峰值
  const CHUNK_SIZE = 200
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE)
    runInsertTransaction(chunk)
  }

  if (!opts?.silent) {
    for (const id of enqueuedIds) {
      emitTask(id)
    }
  }
  downloadEvents.emit('batch_enqueued', { count: enqueuedIds.length, ids: enqueuedIds })
  kickWorker()

  return {
    total: items.length,
    enqueued: enqueuedIds.length,
    ids: enqueuedIds,
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
    getDb()
      .prepare(
        `UPDATE download_tasks SET status='cancelled', updated_at=?, error=?, file_path=NULL, lyric_path=NULL, file_size=NULL WHERE id=?`,
      )
      .run(nowIso(), '用户取消', id)
  }
  emitTask(id)
  return getTask(id)!
}

export function batchCancelTasks(ids?: string[], opts?: { tab?: 'running' }) {
  const targetIds: string[] = []
  if (ids && ids.length > 0) {
    targetIds.push(...ids)
  } else if (opts?.tab === 'running') {
    const rows = getDb().prepare(`SELECT id FROM download_tasks WHERE status IN ('running', 'queued')`).all() as Array<{ id: string }>
    targetIds.push(...rows.map((r) => r.id))
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
  if (quality) {
    const allowed = new Set(['highest', 'flac24bit', 'flac', '320k', '128k'])
    if (!allowed.has(quality)) {
      throw createError({ statusCode: 400, statusMessage: `不支持的音质: ${quality}` })
    }
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
  const allowed = new Set(['highest', 'flac24bit', 'flac', '320k', '128k'])
  if (!allowed.has(quality)) {
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

export function batchRetryTasks(ids?: string[], opts?: { resetAttempts?: boolean; tab?: 'failed' }) {
  const targetIds: string[] = []
  if (ids && ids.length > 0) {
    targetIds.push(...ids)
  } else if (opts?.tab === 'failed') {
    const rows = getDb().prepare(`SELECT id FROM download_tasks WHERE status IN ('failed', 'cancelled')`).all() as Array<{ id: string }>
    targetIds.push(...rows.map((r) => r.id))
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

/** 批量换源：可统一 sourceId，或按任务指定 sourceById */
export function batchSwitchSourceAndRetry(
  ids: string[],
  opts?: { sourceId?: string; sourceById?: Record<string, string> },
) {
  const items = []
  for (const id of ids) {
    try {
      const sourceId = opts?.sourceById?.[id] || opts?.sourceId
      items.push(switchSourceAndRetry(id, sourceId ? { sourceId } : undefined))
    } catch (e: unknown) {
      const err = e as { statusMessage?: string; message?: string }
      items.push({ id, error: err?.statusMessage || err?.message || String(e) })
    }
  }
  kickWorker()
  return { count: ids.length, items }
}

const lastEmitTimeByTaskId = new Map<string, number>()
const lastEmitProgressByTaskId = new Map<string, number>()

function updateTask(id: string, patch: Partial<DownloadTaskRow>, opts?: { throttleProgress?: boolean }) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE download_tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k]), nowIso(), id)

  if (opts?.throttleProgress && patch.progress != null) {
    const now = Date.now()
    const lastTime = lastEmitTimeByTaskId.get(id) || 0
    const lastProg = lastEmitProgressByTaskId.get(id) ?? -1
    const progDiff = Math.abs(patch.progress - lastProg)
    if (now - lastTime < 250 && progDiff < 0.05 && patch.progress < 0.99) {
      return
    }
    lastEmitTimeByTaskId.set(id, now)
    lastEmitProgressByTaskId.set(id, patch.progress)
  } else {
    lastEmitTimeByTaskId.delete(id)
    lastEmitProgressByTaskId.delete(id)
  }
  emitTask(id)
}
export function ensureDiskWritable(dir: string) {
  return assertDownloadDirWritable(dir)
}

async function resolveUrl(task: DownloadTaskRow, qualityPref: string) {
  const musicInfo = JSON.parse(task.music_info_json || '{}')
  const result = await resolveMusicUrl({
    platform: task.platform,
    musicInfo,
    quality: qualityPref,
    sourceId: task.source_id,
  })
  // highest 轮询成功后可能换了音源，写回任务
  if (result.sourceId && result.sourceId !== task.source_id) {
    updateTask(task.id, { source_id: result.sourceId })
    task.source_id = result.sourceId
  }
  return { url: result.url, quality: result.quality }
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
    if (total < minBytes) throw previewSizeError(total, expected)
  }
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  const out = createWriteStream(dest)
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
  }
}

async function processTask(task: DownloadTaskRow) {
  const settings = getSettings()
  const abortController = new AbortController()
  activeAbortControllers.set(task.id, abortController)
  activeProcessingTasks.add(task.id)
  updateTask(task.id, { status: 'running', progress: 0.01, error: null })
  let filePath: string | null = null
  let lyricPath: string | null = null
  try {
    ensureDownloadDirWritable(settings.downloadDir)
    const musicInfo = JSON.parse(task.music_info_json || '{}') as Record<string, unknown>
    const { url, quality } = await resolveUrl(task, task.quality || settings.defaultQuality)
    if (abortController.signal.aborted) throw new Error('cancelled')
    if (isLikelyPreviewUrl(url)) throw previewUrlError()

    const expectedDuration = expectedDurationFromMusicInfo(musicInfo)

    const dir = getDownloadDir(settings.downloadDir)
    const trackNo = (musicInfo.track || musicInfo.trackNo || musicInfo.tracknum || musicInfo.no) as string | number | undefined
    const base = applyNameTemplate(settings.nameTemplate, {
      artist: task.artist,
      title: task.title,
      album: task.album || undefined,
      platform: task.platform,
      quality,
      id: task.external_id || undefined,
      track: trackNo,
    })
    const ext = guessExt(url, quality)
    filePath = join(dir, `${base}.${ext}`)
    await downloadFile(
      url,
      filePath,
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

    // 按文件魔数纠正扩展名，避免「标称 flac、实为 mp3」导致元数据写入失败
    filePath = alignFileExtension(filePath, base, dir)

    let fileSize: number | null = null
    try {
      fileSize = statSync(filePath).size
    } catch {
      fileSize = null
    }

    // 试听检测：有期望时长则对比；否则兜底识别常见固定试听时长
    {
      const actual = await probeAudioDurationSeconds(filePath)
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

    if (lrcText && lyricMode === 'external') {
      lyricPath = join(dir, `${base}.lrc`)
      writeFileSync(lyricPath, lrcText, 'utf8')
    }

    // 元数据：基础字段 + 封面 +（仅内嵌模式）歌词
    const metaResult = await writeAudioMetadata(
      filePath,
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

    // 取消竞态：完成后才发现已取消 → 删文件
    if (abortController.signal.aborted) {
      removeFileQuiet(filePath)
      removeFileQuiet(lyricPath)
      throw new Error('cancelled')
    }

    updateTask(task.id, {
      status: 'completed',
      progress: 1,
      file_path: filePath,
      lyric_path: lyricPath,
      quality,
      file_size: fileSize,
      error: null,
    })
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; name?: string }
    let msg = e?.message || String(err)
    if (isDownloadPermissionError(err) && !/无下载目录写入权限/.test(msg)) {
      msg = `无下载目录写入权限: ${settings.downloadDir}`
      Object.assign(err as object, { code: 'EACCES' })
    }
    removeFileQuiet(filePath)
    removeFileQuiet(lyricPath)
    if (msg === 'cancelled' || abortController.signal.aborted || e?.name === 'AbortError') {
      updateTask(task.id, {
        status: 'cancelled',
        error: '用户取消',
        file_path: null,
        lyric_path: null,
        file_size: null,
      })
      return
    }
    const attempts = (task.attempts || 0) + 1
    const settings2 = getSettings()
    const qualityPref = task.quality || settings2.defaultQuality
    const fixedQuality = !isHighestQuality(qualityPref)
    // 试听片段：只标失败，不自动换源/重试；由用户在队列手动换源
    const isPreview = String(e?.code) === 'PREVIEW_CLIP'
    const isPerm = isDownloadPermissionError(err)
    // 固定音质：resolve 已轮询全部音源；失败即停并提示原因
    const retryable = isPreview || isPerm
      ? false
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
      updateTask(task.id, {
        status: 'queued',
        attempts,
        source_id: next?.id || task.source_id,
        error: `失败重试(${attempts}/${settings2.maxAttempts}): ${msg}`,
        progress: 0,
        file_path: null,
        lyric_path: null,
        file_size: null,
      })
      setTimeout(() => kickWorker(), 500)
    } else {
      updateTask(task.id, {
        status: 'failed',
        attempts,
        error: msg,
        progress: 0,
        file_path: null,
        lyric_path: null,
        file_size: null,
      })
    }
  } finally {
    activeAbortControllers.delete(task.id)
    activeProcessingTasks.delete(task.id)
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

/** 若魔数与扩展名不一致则重命名到正确后缀 */
function alignFileExtension(filePath: string, base: string, dir: string): string {
  const sniffed = sniffAudioExt(filePath)
  if (!sniffed) return filePath
  const cur = filePath.includes('.') ? filePath.split('.').pop()!.toLowerCase() : ''
  if (cur === sniffed) return filePath
  const next = join(dir, `${base}.${sniffed}`)
  if (next === filePath) return filePath
  try {
    if (existsSync(next) && next !== filePath) unlinkSync(next)
    renameSync(filePath, next)
    console.warn(`[download] 扩展名已纠正: .${cur || '?'} → .${sniffed}`)
    return next
  } catch (e: unknown) {
    const err = e as { message?: string }
    console.warn('[download] 扩展名纠正失败:', err?.message || e)
    return filePath
  }
}

export async function tickWorker() {
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

    const next = getDb()
      .prepare(`SELECT * FROM download_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as DownloadTaskRow | undefined
    if (!next) break

    const changed = getDb()
      .prepare(`UPDATE download_tasks SET status='running', updated_at=? WHERE id=? AND status='queued'`)
      .run(nowIso(), next.id)
    if (changed.changes === 0) break

    const fresh = getTask(next.id)!
    lastStartedAt = Date.now()
    void queue.add(async () => {
      try {
        await processTask({ ...fresh, status: 'queued' })
      } finally {
        lastFinishedAt = Date.now()
        kickWorker()
      }
    })
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
