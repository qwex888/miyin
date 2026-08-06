import { createWriteStream, existsSync } from 'node:fs'
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
import { nextStatusAfterFailure } from './downloadState'

export type { TaskStatus } from './downloadState'
export { nextStatusAfterFailure } from './downloadState'

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
  created_at: string
  updated_at: string
}

let running = 0
let loopTimer: NodeJS.Timeout | null = null
const cancelSet = new Set<string>()

function nowIso() {
  return new Date().toISOString()
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unknown'
}

export function applyNameTemplate(template: string, meta: { artist: string; title: string; album?: string }) {
  return sanitizeFilename(
    template
      .replace('{artist}', meta.artist || '未知')
      .replace('{title}', meta.title || '未知')
      .replace('{album}', meta.album || ''),
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
}) {
  const settings = getSettings()
  const id = randomUUID()
  const ts = nowIso()
  const sources = listEnabledOkSources(input.platform)
  const sourceId = input.sourceId || sources[0]?.id
  if (!sourceId) {
    throw createError({ statusCode: 400, statusMessage: `没有可用音源支持平台 ${input.platform}` })
  }

  getDb()
    .prepare(
      `INSERT INTO download_tasks (
        id, title, artist, album, platform, source_id, quality, status, progress,
        external_id, match_method, music_info_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
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
      JSON.stringify({ ...input.musicInfo, __downloadLyric: input.downloadLyric ?? settings.downloadLyric }),
      ts,
      ts,
    )
  kickWorker()
  return getTask(id)!
}

export function cancelTask(id: string) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  cancelSet.add(id)
  if (task.status === 'queued' || task.status === 'running') {
    getDb()
      .prepare(`UPDATE download_tasks SET status='cancelled', updated_at=?, error=? WHERE id=?`)
      .run(nowIso(), '用户取消', id)
  }
  return getTask(id)!
}

export function retryTask(id: string) {
  const task = getTask(id)
  if (!task) throw createError({ statusCode: 404, statusMessage: '任务不存在' })
  getDb()
    .prepare(
      `UPDATE download_tasks SET status='queued', progress=0, error=NULL, updated_at=? WHERE id=?`,
    )
    .run(nowIso(), id)
  kickWorker()
  return getTask(id)!
}

function updateTask(id: string, patch: Partial<DownloadTaskRow>) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE download_tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch as any)[k]), nowIso(), id)
}

async function resolveUrl(task: DownloadTaskRow, quality: string) {
  const source = getSource(task.source_id!)
  if (!source?.local_path) throw new Error('音源文件缺失')
  const handle = loadLxSource(source.local_path)
  try {
    const available = handle.qualityMap[task.platform] || ['128k', '320k']
    const q = pickQuality(available, quality)
    const musicInfo = JSON.parse(task.music_info_json || '{}')
    const url = await handle.getMusicUrl(task.platform, musicInfo, q)
    return { url, quality: q, handle }
  } catch (err) {
    handle.dispose()
    throw err
  }
}

async function downloadFile(url: string, dest: string, onProgress: (p: number) => void, taskId: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'miyin/0.1', Referer: 'https://www.google.com/' },
  })
  if (!res.ok || !res.body) throw new Error(`下载 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as any)
  const out = createWriteStream(dest)
  nodeStream.on('data', (chunk: Buffer) => {
    if (cancelSet.has(taskId)) {
      nodeStream.destroy(new Error('cancelled'))
      return
    }
    received += chunk.length
    if (total > 0) onProgress(Math.min(0.99, received / total))
  })
  await pipeline(nodeStream, out)
  onProgress(1)
}

async function processTask(task: DownloadTaskRow) {
  const settings = getSettings()
  updateTask(task.id, { status: 'running', progress: 0.01, error: null })
  try {
    const musicInfo = JSON.parse(task.music_info_json || '{}')
    const { url, quality } = await resolveUrl(task, task.quality || settings.defaultQuality)
    if (cancelSet.has(task.id)) throw new Error('cancelled')

    const dir = getDownloadDir(settings.downloadDir)
    const base = applyNameTemplate(settings.nameTemplate, {
      artist: task.artist,
      title: task.title,
      album: task.album || undefined,
    })
    const ext = guessExt(url, quality)
    const filePath = join(dir, `${base}.${ext}`)
    await downloadFile(url, filePath, (p) => updateTask(task.id, { progress: p, quality }), task.id)

    let lyricPath: string | null = null
    if (musicInfo.__downloadLyric !== false && settings.downloadLyric) {
      try {
        const lrc = await fetchLyric(task.platform, musicInfo)
        if (lrc) {
          lyricPath = join(dir, `${base}.lrc`)
          const { writeFileSync } = await import('node:fs')
          writeFileSync(lyricPath, lrc, 'utf8')
        }
      } catch {
        /* 歌词失败不阻断 */
      }
    }

    updateTask(task.id, {
      status: 'completed',
      progress: 1,
      file_path: filePath,
      lyric_path: lyricPath,
      quality,
      error: null,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    if (msg === 'cancelled' || cancelSet.has(task.id)) {
      updateTask(task.id, { status: 'cancelled', error: '用户取消' })
      return
    }
    const attempts = (task.attempts || 0) + 1
    const settings2 = getSettings()
    if (settings2.autoFailover && attempts < settings2.maxAttempts) {
      const alts = listEnabledOkSources(task.platform).filter((s) => s.id !== task.source_id)
      const nextStatus = nextStatusAfterFailure({
        attempts,
        maxAttempts: settings2.maxAttempts,
        autoFailover: settings2.autoFailover,
        hasAltSource: alts.length > 0,
      })
      if (nextStatus === 'queued') {
        const next = alts[(attempts - 1) % Math.max(alts.length, 1)]
        updateTask(task.id, {
          status: 'queued',
          attempts,
          source_id: next?.id || task.source_id,
          error: `失败换源重试(${attempts}): ${msg}`,
          progress: 0,
        })
      } else {
        updateTask(task.id, { status: 'failed', attempts, error: msg, progress: 0 })
      }
    } else {
      updateTask(task.id, { status: 'failed', attempts, error: msg, progress: 0 })
    }
  } finally {
    cancelSet.delete(task.id)
  }
}

function guessExt(url: string, quality: string) {
  const u = url.toLowerCase()
  if (u.includes('.flac') || quality === 'flac') return 'flac'
  if (u.includes('.m4a')) return 'm4a'
  if (u.includes('.ape')) return 'ape'
  return 'mp3'
}

export async function tickWorker() {
  const settings = getSettings()
  while (running < settings.concurrency) {
    const next = getDb()
      .prepare(`SELECT * FROM download_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as DownloadTaskRow | undefined
    if (!next) break
    // 乐观锁：先标 running 防并发双取
    const changed = getDb()
      .prepare(`UPDATE download_tasks SET status='running', updated_at=? WHERE id=? AND status='queued'`)
      .run(nowIso(), next.id)
    if (changed.changes === 0) break
    const fresh = getTask(next.id)!
    running += 1
    void processTask({ ...fresh, status: 'queued' }).finally(() => {
      running -= 1
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
  }, 1500)
  void tickWorker()
}

/** 状态机辅助已移至 downloadState，避免重复 */
