import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** 解析 interval / duration 为秒。支持 "4:28"、"1:02:03"、秒数字、毫秒大数 */
export function parseIntervalToSeconds(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw > 10_000 ? raw / 1000 : raw
  }
  const s = String(raw).trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n) || n <= 0) return null
    return n > 10_000 ? n / 1000 : n
  }
  const parts = s.split(':').map((x) => Number(x))
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return null
}

export function expectedDurationFromMusicInfo(musicInfo: Record<string, any>): number | null {
  return (
    parseIntervalToSeconds(musicInfo.interval) ||
    parseIntervalToSeconds(musicInfo.duration) ||
    parseIntervalToSeconds(musicInfo.dt) ||
    parseIntervalToSeconds(musicInfo.time) ||
    null
  )
}

/**
 * 判定是否疑似试听：
 * - 实际时长 < 期望的 50%
 * - 或期望 ≥90s 且实际 ≤65s（覆盖 20/30/35s 及 QQ 常见 60s 试听）
 */
export function isLikelyPreviewClip(actualSec: number, expectedSec: number): boolean {
  if (!(actualSec > 0) || !(expectedSec > 0)) return false
  if (actualSec < expectedSec * 0.5) return true
  if (expectedSec >= 90 && actualSec <= 65) return true
  return false
}

/**
 * 无期望时长时的兜底：命中平台常见固定试听时长，且体积不像整曲。
 * QQ 试听常为精确 60.0s + ~960KB@128k。
 */
export function isLikelyPreviewByAbsoluteDuration(
  actualSec: number,
  fileBytes?: number | null,
): boolean {
  if (!(actualSec > 0)) return false
  const near = (t: number, tol = 0.6) => Math.abs(actualSec - t) <= tol
  if (!(near(60) || near(30) || near(35) || near(20))) return false
  // 短于 90s 的整曲可能碰巧接近这些秒数；体积明显偏大则放过
  if (fileBytes != null && fileBytes > 2_500_000) return false
  return true
}

export function isLikelyPreviewUrl(url: string): boolean {
  return /preview|trial|clip|试听|audition|snippet|fragment|试听\d/i.test(url)
}

/** 按期望时长与最低合理码率估算「整曲」下限字节数（用于 Content-Length 预检） */
export function minFullTrackBytes(expectedSec: number, qualityHint?: string | null): number {
  // 试听常为 128k 左右；用 96kbps × 50% 时长作宽松下限，避免误杀低码率整曲
  let kbps = 96
  const q = (qualityHint || '').toLowerCase()
  if (q.includes('flac') || q === 'highest') kbps = 200
  else if (q.includes('320')) kbps = 160
  else if (q.includes('128')) kbps = 96
  return Math.floor(expectedSec * 0.5 * ((kbps * 1000) / 8))
}

export function probeAudioDurationSeconds(filePath: string): Promise<number | null> {
  if (!existsSync(filePath)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let out = ''
    p.stdout?.on('data', (c) => {
      out += String(c)
    })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const n = Number(String(out).trim())
      resolve(Number.isFinite(n) && n > 0 ? n : null)
    })
  })
}

export function previewClipError(actualSec: number, expectedSec?: number | null): Error {
  const detail =
    expectedSec && expectedSec > 0
      ? `实际 ${Math.round(actualSec)}s / 期望约 ${Math.round(expectedSec)}s`
      : `实际约 ${Math.round(actualSec)}s，疑似平台固定试听时长`
  const err = new Error(`疑似试听片段（${detail}），请换源后重试`)
  ;(err as any).code = 'PREVIEW_CLIP'
  return err
}

export function previewUrlError(): Error {
  const err = new Error('音源返回疑似试听链接，请换源后重试')
  ;(err as any).code = 'PREVIEW_CLIP'
  return err
}

export function previewSizeError(contentLength: number, expectedSec: number): Error {
  const err = new Error(
    `响应体积过小（${Math.round(contentLength / 1024)}KB，期望时长约 ${Math.round(expectedSec)}s），疑似试听，请换源后重试`,
  )
  ;(err as any).code = 'PREVIEW_CLIP'
  return err
}
