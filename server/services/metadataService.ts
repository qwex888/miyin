import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, renameSync, unlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sniffAudioExt } from '../utils/audioSniff'

let ffmpegAvailable: boolean | null = null

export function checkFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable != null) return Promise.resolve(ffmpegAvailable)
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    p.on('error', () => {
      ffmpegAvailable = false
      resolve(false)
    })
    p.on('close', (code) => {
      ffmpegAvailable = code === 0
      resolve(ffmpegAvailable)
    })
  })
}

export type AudioMetadataInput = {
  title?: string
  artist?: string
  album?: string
  track?: string | number
  disc?: string | number
  date?: string | number
  year?: string | number
  genre?: string
  comment?: string
  lyrics?: string
  coverUrl?: string
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (c) => {
      err += String(c)
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.slice(-800) || `ffmpeg exit ${code}`))
    })
  })
}

async function downloadCover(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'miyin/0.1' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100 || buf.length > 8 * 1024 * 1024) return false
    writeFileSync(dest, buf)
    return true
  } catch {
    return false
  }
}

function pickMeta(musicInfo: Record<string, any>, task: {
  title: string
  artist: string
  album: string | null
  platform: string
  quality: string | null
  external_id: string | null
}): AudioMetadataInput {
  const track = musicInfo.track || musicInfo.trackNo || musicInfo.tracknum || musicInfo.no
  const disc = musicInfo.disc || musicInfo.discNo || musicInfo.disk
  const year = musicInfo.year || musicInfo.publishTime || musicInfo.publish_time
  const date =
    typeof year === 'number' && year > 1e11
      ? new Date(year).getFullYear()
      : musicInfo.date || year
  const genre = musicInfo.genre || musicInfo.style
  const commentParts = [
    musicInfo.comment,
    `source=${task.platform}`,
    task.quality ? `quality=${task.quality}` : '',
    task.external_id ? `id=${task.external_id}` : '',
  ].filter(Boolean)

  return {
    title: task.title || musicInfo.name || musicInfo.songname,
    artist: task.artist || musicInfo.singer || musicInfo.artist,
    album: task.album || musicInfo.albumName || musicInfo.album || undefined,
    track: track != null && String(track) !== '' ? track : undefined,
    disc: disc != null && String(disc) !== '' ? disc : undefined,
    date: date != null && String(date) !== '' ? date : undefined,
    year: typeof date === 'number' ? date : undefined,
    genre: genre ? String(genre) : undefined,
    comment: commentParts.join(' | ') || undefined,
    coverUrl: musicInfo.img || musicInfo.pic || musicInfo.cover || musicInfo.albumPic || undefined,
  }
}

/**
 * 用 ffmpeg 写入元数据（方案 B）。无 ffmpeg 或失败时返回 false，不抛错阻断下载。
 */
export async function writeAudioMetadata(
  filePath: string,
  task: {
    title: string
    artist: string
    album: string | null
    platform: string
    quality: string | null
    external_id: string | null
  },
  musicInfo: Record<string, any>,
  lyrics?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (!existsSync(filePath)) return { ok: false, reason: 'file missing' }
  if (!(await checkFfmpegAvailable())) {
    return { ok: false, reason: '未检测到 ffmpeg，跳过元数据写入（飞牛环境请安装 ffmpeg）' }
  }

  const meta = pickMeta(musicInfo, task)
  if (lyrics) meta.lyrics = lyrics

  const dir = mkdtempSync(join(tmpdir(), 'miyin-meta-'))
  const sniffed = sniffAudioExt(filePath)
  const extFromName = (extname(filePath) || '.mp3').replace(/^\./, '').toLowerCase()
  const extNorm = (sniffed || extFromName || 'mp3').toLowerCase()
  const ext = `.${extNorm}`
  const outPath = join(dir, `out${ext}`)
  const coverPath = join(dir, 'cover.jpg')
  let hasCover = false
  if (meta.coverUrl) {
    hasCover = await downloadCover(String(meta.coverUrl), coverPath)
  }

  // 仅在容器与编码一致时嵌封面；否则只写标签，避免 mp3 内容写进 .flac 失败
  const attachCover =
    hasCover &&
    (extNorm === 'mp3' || extNorm === 'm4a' || extNorm === 'flac' || extNorm === 'ogg') &&
    (!sniffed || sniffed === extNorm)

  const args = ['-y', '-i', filePath]
  if (attachCover) {
    args.push('-i', coverPath, '-map', '0:a', '-map', '1', '-c', 'copy', '-disposition:v:0', 'attached_pic')
  } else {
    args.push('-map', '0', '-c', 'copy')
  }

  const add = (k: string, v: unknown) => {
    if (v == null || String(v).trim() === '') return
    args.push('-metadata', `${k}=${String(v)}`)
  }
  add('title', meta.title)
  add('artist', meta.artist)
  add('album', meta.album)
  add('track', meta.track)
  add('disc', meta.disc)
  add('date', meta.date ?? meta.year)
  add('genre', meta.genre)
  add('comment', meta.comment)
  add('lyrics', meta.lyrics)
  // 部分播放器读 LYRICS / unsynced lyrics
  add('LYRICS', meta.lyrics)

  if (attachCover) {
    args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
  }

  // MP3 兼容
  if (extNorm === 'mp3') {
    args.push('-id3v2_version', '3')
  }

  args.push(outPath)

  try {
    await runFfmpeg(args)
    const bak = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.bak`)
    copyFileSync(filePath, bak)
    try {
      renameSync(outPath, filePath)
      unlinkSync(bak)
    } catch (e) {
      try {
        renameSync(bak, filePath)
      } catch {
        /* ignore */
      }
      throw e
    }
    return { ok: true }
  } catch (err: any) {
    console.warn('[metadata] ffmpeg failed:', err?.message || err)
    return { ok: false, reason: err?.message || String(err) }
  } finally {
    for (const f of [outPath, coverPath]) {
      try {
        if (existsSync(f)) unlinkSync(f)
      } catch {
        /* ignore */
      }
    }
    try {
      const { rmSync } = await import('node:fs')
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
