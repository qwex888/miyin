import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, renameSync, unlinkSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs'
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

/** 封面 URL 候选：原链 + http→https */
function coverUrlCandidates(raw: string): string[] {
  const u = String(raw || '').trim()
  if (!u) return []
  const out = [u]
  if (u.startsWith('http://')) out.push(`https://${u.slice('http://'.length)}`)
  return [...new Set(out)]
}

async function downloadCoverRaw(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'miyin/0.1',
        Referer: 'https://music.163.com/',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    // 部分图床常返回 1～2MB PNG；放宽到 12MB，后续会压成 JPEG
    if (buf.length < 100 || buf.length > 12 * 1024 * 1024) return false
    // 简单魔数校验，避免下到 HTML
    const isImg =
      buf[0] === 0xff && buf[1] === 0xd8 || // jpeg
      (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') ||
      buf.toString('ascii', 0, 4) === 'RIFF' ||
      buf.toString('ascii', 0, 4) === 'GIF8'
    if (!isImg) return false
    writeFileSync(dest, buf)
    return true
  } catch {
    return false
  }
}

/**
 * 统一转成适中 JPEG 再嵌入：
 * - 标称「.jpg」实为 PNG、体积过大时，不少播放器对 FLAC 封面不显示
 * - JPEG + ≤1000px 兼容性最好
 */
async function prepareCoverJpeg(rawPath: string, jpegPath: string): Promise<boolean> {
  try {
    await runFfmpeg([
      '-y',
      '-i',
      rawPath,
      '-vf',
      "scale='min(1000,iw)':'-1'",
      '-q:v',
      '3',
      jpegPath,
    ])
    return existsSync(jpegPath) && readFileSync(jpegPath).length > 500
  } catch {
    return false
  }
}

async function resolveCoverJpeg(coverUrl: string, dir: string): Promise<string | null> {
  const rawPath = join(dir, 'cover.raw')
  const jpegPath = join(dir, 'cover.jpg')
  for (const url of coverUrlCandidates(coverUrl)) {
    if (!(await downloadCoverRaw(url, rawPath))) continue
    if (await prepareCoverJpeg(rawPath, jpegPath)) return jpegPath
  }
  return null
}

/** FLAC 是否含 METADATA_BLOCK_PICTURE（type=6） */
export function flacHasPictureBlock(filePath: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')
    const headerBuf = Buffer.allocUnsafe(4)
    if (readSync(fd, headerBuf, 0, 4, 0) < 4 || headerBuf.toString('ascii') !== 'fLaC') {
      return false
    }
    let pos = 4
    const blockHead = Buffer.allocUnsafe(4)
    for (let i = 0; i < 64; i++) {
      if (readSync(fd, blockHead, 0, 4, pos) < 4) break
      const isLast = (blockHead[0]! & 0x80) !== 0
      const type = blockHead[0]! & 0x7f
      const size = (blockHead[1]! << 16) | (blockHead[2]! << 8) | blockHead[3]!
      if (type === 6 && size > 0) return true
      pos += 4 + size
      if (isLast) break
    }
  } catch {
    /* ignore */
  } finally {
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
  return false
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

  let coverJpeg: string | null = null
  if (meta.coverUrl) {
    coverJpeg = await resolveCoverJpeg(String(meta.coverUrl), dir)
    if (!coverJpeg) {
      console.warn('[metadata] cover download/convert failed:', meta.coverUrl)
    }
  }

  // 仅在容器与编码一致时嵌封面；否则只写标签，避免 mp3 内容写进 .flac 失败
  const attachCover =
    !!coverJpeg &&
    (extNorm === 'mp3' || extNorm === 'm4a' || extNorm === 'flac' || extNorm === 'ogg') &&
    (!sniffed || sniffed === extNorm)

  const args = ['-y', '-i', filePath]
  if (attachCover && coverJpeg) {
    // 只映射音频 + 封面，去掉可能已有的无效封面流；统一用 JPEG 提升 FLAC 兼容性
    args.push(
      '-i',
      coverJpeg,
      '-map',
      '0:a:0',
      '-map',
      '1:0',
      '-c:a',
      'copy',
      '-c:v',
      'mjpeg',
      '-disposition:v:0',
      'attached_pic',
    )
  } else {
    // 无新封面时保留原有流（可能已有封面）
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
  add('LYRICS', meta.lyrics)

  if (attachCover) {
    args.push('-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)')
  }

  if (extNorm === 'mp3') {
    args.push('-id3v2_version', '3')
  }

  args.push(outPath)

  try {
    await runFfmpeg(args)
    if (extNorm === 'flac' && attachCover && !flacHasPictureBlock(outPath)) {
      throw new Error('FLAC 封面写入后未检测到 PICTURE 块')
    }
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
    for (const f of [outPath, join(dir, 'cover.raw'), join(dir, 'cover.jpg')]) {
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
