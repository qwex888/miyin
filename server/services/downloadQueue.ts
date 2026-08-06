import { EventEmitter } from 'node:events'
import {
  createWriteStream,
  unlinkSync,
  existsSync,
  accessSync,
  constants,
  statSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb } from '../utils/db'
import { getDownloadDir } from '../utils/paths'
import { getSettings } from './settingsService'
import { getSource, listEnabledOkSources } from './sourceRegistry'
import { loadLxSource, pickQuality } from './sourceRuntime'
import { fetchLyric } from './lyricService'
import { writeAudioMetadata } from './metadataService'
import { sniffAudioExt } from '../utils/audioSniff'
import { nextStatusAfterFailure, isRetryableError } from './downloadState'

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

let running = 0
let loopTimer: NodeJS.Timeout | null = null
const cancelSet = new Set<string>()

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

export function listTasks(status?: string) {
  if (status) {
    return getDb().prepare('SELECT * FROM download_tasks WHERE status = ? ORDER BY created_at DESC').all(status) as DownloadTaskRow[]
  }
  return getDb().prepare('SELECT * FROM download_tasks ORDER BY created_at DESC LIMIT 200').all() as DownloadTaskRow[]
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

export function enqueueDownload(input: {
  title: string
  artist: string
  album?: string
  platform: string
  sourceId?: string
  quality?: string
  musicInfo: Record<string, any>
  externalId?: string
  matchMethod?: string
  downloadLyric?: boolean
  lyricMode?: 'external' | 'embedded'
  batchId?: string
  playlistUrl?: string
}) {
  const settings = getSettings()
  ensureDiskWritable(settings.downloadDir)

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

export function cancelTask(id: string) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  cancelSet.add(id)

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

export function batchCancelTasks(ids: string[]) {
  const items = []
  for (const id of ids) {
    try {
      items.push(cancelTask(id))
    } catch (e: any) {
      items.push({ id, error: e?.message || String(e) })
    }
  }
  return { count: ids.length, items }
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

export function batchDeleteTasks(ids: string[], opts?: { deleteLocalFiles?: boolean }) {
  let deleted = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of ids) {
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
export function retryTask(id: string, opts?: { resetAttempts?: boolean }) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  if (task.status === 'running') {
    throw createError({ statusCode: 400, statusMessage: '任务进行中，请先取消再重试' })
  }
  removeTaskFiles(task)
  const settings = getSettings()
  ensureDiskWritable(settings.downloadDir)
  getDb()
    .prepare(
      `UPDATE download_tasks SET status='queued', progress=0, error=NULL, file_path=NULL, lyric_path=NULL, file_size=NULL,
       attempts=?, updated_at=? WHERE id=?`,
    )
    .run(opts?.resetAttempts ? 0 : task.attempts, nowIso(), id)
  emitTask(id)
  kickWorker()
  return getTask(id)!
}

export function batchRetryTasks(ids: string[], opts?: { resetAttempts?: boolean }) {
  const items = []
  for (const id of ids) {
    try {
      items.push(retryTask(id, opts))
    } catch (e: any) {
      items.push({ id, error: e?.message || String(e) })
    }
  }
  kickWorker()
  return { count: ids.length, items }
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
  ensureDiskWritable(settings.downloadDir)

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
    } catch (e: any) {
      items.push({ id, error: e?.statusMessage || e?.message || String(e) })
    }
  }
  kickWorker()
  return { count: ids.length, items }
}

function updateTask(id: string, patch: Partial<DownloadTaskRow>) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE download_tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch as any)[k]), nowIso(), id)
  emitTask(id)
}

export function ensureDiskWritable(dir: string) {
  const resolved = getDownloadDir(dir)
  try {
    accessSync(resolved, constants.W_OK)
  } catch (err: any) {
    const e = new Error(`下载目录不可写: ${resolved}`)
    ;(e as any).code = err?.code || 'EACCES'
    throw e
  }
  return resolved
}

async function resolveUrl(task: DownloadTaskRow, quality: string) {
  const source = getSource(task.source_id!)
  if (!source?.local_path) throw new Error('音源文件缺失')
  const handle = await loadLxSource(source.local_path)
  const available = handle.qualityMap[task.platform] || ['128k', '320k']
  const q = pickQuality(available, quality)
  const musicInfo = JSON.parse(task.music_info_json || '{}')
  const url = await handle.getMusicUrl(task.platform, musicInfo, q)
  return { url, quality: q }
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress: (p: number, received: number, total: number) => void,
  taskId: string,
) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'miyin/0.1', Referer: 'https://www.google.com/' },
  })
  if (!res.ok || !res.body) {
    const err = new Error(`下载 HTTP ${res.status}`)
    ;(err as any).code = res.status >= 500 || res.status === 429 ? 'HTTP_RETRY' : 'HTTP_FATAL'
    throw err
  }
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as any)
  const out = createWriteStream(dest)
  try {
    nodeStream.on('data', (chunk: Buffer) => {
      if (cancelSet.has(taskId)) {
        nodeStream.destroy(new Error('cancelled'))
        return
      }
      received += chunk.length
      if (total > 0) onProgress(Math.min(0.99, received / total), received, total)
      else onProgress(Math.min(0.95, received / (received + 1024 * 1024)), received, 0)
    })
    await pipeline(nodeStream, out)
    onProgress(1, received, total || received)
    return { received, total: total || received }
  } catch (err) {
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
  updateTask(task.id, { status: 'running', progress: 0.01, error: null })
  let filePath: string | null = null
  let lyricPath: string | null = null
  try {
    ensureDiskWritable(settings.downloadDir)
    const musicInfo = JSON.parse(task.music_info_json || '{}')
    const { url, quality } = await resolveUrl(task, task.quality || settings.defaultQuality)
    if (cancelSet.has(task.id)) throw new Error('cancelled')

    const dir = getDownloadDir(settings.downloadDir)
    const trackNo = musicInfo.track || musicInfo.trackNo || musicInfo.tracknum || musicInfo.no
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
        updateTask(task.id, {
          progress: p,
          quality,
          file_size: total > 0 ? total : received || null,
        }),
      task.id,
    )

    if (cancelSet.has(task.id)) throw new Error('cancelled')

    // 按文件魔数纠正扩展名，避免「标称 flac、实为 mp3」导致元数据写入失败
    filePath = alignFileExtension(filePath, base, dir)

    let fileSize: number | null = null
    try {
      fileSize = statSync(filePath).size
    } catch {
      fileSize = null
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
    if (cancelSet.has(task.id)) {
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
  } catch (err: any) {
    const msg = err?.message || String(err)
    removeFileQuiet(filePath)
    removeFileQuiet(lyricPath)
    if (msg === 'cancelled' || cancelSet.has(task.id)) {
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
    const retryable = isRetryableError(err) || String(err?.code) === 'HTTP_RETRY'
    const alts = listEnabledOkSources(task.platform).filter((s) => s.id !== task.source_id)
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
    cancelSet.delete(task.id)
  }
}

function guessExt(url: string, quality: string) {
  const u = url.toLowerCase()
  // 优先看明确后缀；quality=flac 仅作弱提示（下载后会再嗅探纠正）
  if (/\.flac(?:\?|#|$)/i.test(u) || quality === 'flac') return 'flac'
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
  } catch (e: any) {
    console.warn('[download] 扩展名纠正失败:', e?.message || e)
    return filePath
  }
}

export async function tickWorker() {
  const settings = getSettings()
  while (running < settings.concurrency) {
    const next = getDb()
      .prepare(`SELECT * FROM download_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as DownloadTaskRow | undefined
    if (!next) break
    const changed = getDb()
      .prepare(`UPDATE download_tasks SET status='running', updated_at=? WHERE id=? AND status='queued'`)
      .run(nowIso(), next.id)
    if (changed.changes === 0) break
    const fresh = getTask(next.id)!
    running += 1
    void processTask({ ...fresh, status: 'queued' }).finally(() => {
      running -= 1
      kickWorker()
    })
  }
}

export function kickWorker() {
  void tickWorker()
}

export function startDownloadWorker() {
  if (loopTimer) return
  loopTimer = setInterval(() => {
    void tickWorker()
  }, 8000)
  void tickWorker()
}
