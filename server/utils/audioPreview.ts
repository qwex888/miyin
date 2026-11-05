import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { MIN_KBPS_ANY, estimateBitrateKbps, qualityPlausibility } from '#shared/quality'

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

/** ffprobe 实测出的音频参数（L3 用） */
export type AudioProbeInfo = {
  durationSec: number | null
  codec: string | null
  sampleRate: number | null
  bitsPerRawSample: number | null
  channels: number | null
}

/**
 * 解析 `ffprobe -of default=noprint_wrappers=1` 的 `key=value` 输出。
 *
 * 纯函数，便于单测：真实输出里可能出现 `N/A`、缺字段（mp3 没有 `bits_per_raw_sample`），
 * 以及**封面图流**混入（必须靠 `-select_streams a:0` 排除，见 `probeAudioInfo`）。
 */
export function parseFfprobeAudioInfo(stdout: string): AudioProbeInfo {
  const info: AudioProbeInfo = {
    durationSec: null,
    codec: null,
    sampleRate: null,
    bitsPerRawSample: null,
    channels: null,
  }
  const num = (raw: string) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!value || value === 'N/A') continue
    if (key === 'duration') info.durationSec = num(value)
    else if (key === 'codec_name') info.codec = value
    else if (key === 'sample_rate') info.sampleRate = num(value)
    else if (key === 'bits_per_raw_sample') info.bitsPerRawSample = num(value)
    else if (key === 'channels') info.channels = num(value)
  }
  return info
}

/**
 * ffprobe 探测的三种结论。
 *
 * 三者必须分开，否则调用方无法区分「文件不是音频」和「我判断不了」：
 *
 * - `ok`          —— 解析出了音频流，可信
 * - `not-audio`   —— ffprobe **跑通了**，但一个音频字段都没有 ⇒ 明确否定
 * - `unavailable` —— ffprobe **没跑起来**（未安装 / 权限 / 资源耗尽 / 文件读不到）
 *                    ⇒ 没有任何结论，调用方不得据此判定内容无效
 *
 * `unavailable` 单独成一态的原因：ffmpeg 在本项目是**可选依赖**
 * （`packaging/fnos/miyin/cmd/install_init` 只告警不拦截）。把这一态混进
 * `not-audio`，等于让「没装 ffmpeg」变成「所有内容都不是音频」。
 */
export type AudioProbeOutcome =
  | { kind: 'ok'; info: AudioProbeInfo }
  | { kind: 'not-audio' }
  | { kind: 'unavailable' }

/**
 * 一次 ffprobe 同时拿到时长与真实参数（位深 / 采样率 / 声道 / 容器）。
 *
 * **必须带 `-select_streams a:0`** —— 否则封面图（mjpeg）流会混进输出，
 * 解析出来的位深会是图片的 8bit。
 *
 * 相比"只取 duration"的查法，实测耗时与内存完全一致（ffprobe 只读文件头、不解码音频），
 * 所以要位深参数不必付出额外代价。
 */
export function probeAudioContent(filePath: string): Promise<AudioProbeOutcome> {
  if (!existsSync(filePath)) return Promise.resolve({ kind: 'unavailable' })
  return new Promise((resolve) => {
    const p = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,sample_rate,bits_per_raw_sample,channels',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1',
        filePath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let out = ''
    p.stdout?.on('data', (c) => {
      out += String(c)
    })
    // spawn 失败（ffprobe 未安装 → ENOENT、权限不足、资源耗尽）⇒ 判断不了，不是「不是音频」
    p.on('error', () => resolve({ kind: 'unavailable' }))
    p.on('close', () => {
      const info = parseFfprobeAudioInfo(out)
      // 一个字段都没解析到 → ffprobe 确实看过了但没找到音频流
      resolve(
        info.durationSec == null && info.codec == null
          ? { kind: 'not-audio' }
          : { kind: 'ok', info },
      )
    })
  })
}

/**
 * 兼容包装：只要「能拿到的参数」时用。
 *
 * ⚠️ 它会把 `not-audio` 与 `unavailable` 一起折叠成 `null`，
 * 因此**不能**用它判断「内容是不是音频」——那种场景必须用 `probeAudioContent`。
 */
export function probeAudioInfo(filePath: string): Promise<AudioProbeInfo | null> {
  return probeAudioContent(filePath).then((r) => (r.kind === 'ok' ? r.info : null))
}

/** 只要时长时的薄封装（复用同一次 probe，不额外 spawn） */
export async function probeAudioDurationSeconds(filePath: string): Promise<number | null> {
  const info = await probeAudioInfo(filePath)
  return info?.durationSec ?? null
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

export function previewSizeError(contentLength: number, expectedSec: number): Error {
  const err = new Error(
    `响应体积过小（${Math.round(contentLength / 1024)}KB，期望时长约 ${Math.round(expectedSec)}s），疑似试听，请换源后重试`,
  )
  ;(err as any).code = 'PREVIEW_CLIP'
  return err
}

/**
 * 组合预算用尽时的收尾错误 —— 全部候选都返回了**非音频内容**。
 *
 * 与 allPreviewError 分开：症状不同（音源返回的是网页/坏文件，不是试听片段），
 * 提示也不同（多半是直链过期或被 CDN 拦了，换源重试前先看音源可用性）。
 */
export function allInvalidContentError(tried: number): Error {
  const err = new Error(
    `已试过 ${tried} 个音源/音质组合，均未返回可识别的音频内容（音源可能返回了错误页或文件已损坏）`,
  )
  ;(err as any).code = 'INVALID_CONTENT'
  return err
}

/**
 * 组合预算用尽时的收尾错误。
 *
 * 与上面几个的区别：那几个是「这一条路走不通」的中间态，本函数是「已经试过 N 条路」的结论 ——
 * 必须说清试了什么、为什么停，而不是笼统地让用户「请换源后重试」。
 *
 * `hasMore` 为 `true` 表示还有未试过的组合，手动重试可以继续（排除集已持久化在任务上）。
 */
export function allPreviewError(tried: number, hasMore: boolean): Error {
  const tail = hasMore
    ? '，可点「重试」继续尝试其余音源'
    : '，该曲目在当前平台可能仅对会员开放'
  const err = new Error(`已试过 ${tried} 个音源/音质组合，均只返回试听片段${tail}`)
  ;(err as any).code = 'PREVIEW_CLIP'
  return err
}

/**
 * 候选探测结论。
 *
 * - `ok`          码率配得上声称档位
 * - `implausible` 低于该档位下限（如谎报 flac24bit 的 320k mp3）→ **降级排序**但保留作兜底
 * - `preview`     低到不可能是一首歌（内容被截断）→ **硬拒绝**
 * - `unknown`     拿不到响应头信息（无 Content-Length / 无时长 / 压缩传输）→ 不作判断
 * - `error`       请求本身失败（HTTP 4xx/5xx）
 */
export type CandidateVerdict = 'ok' | 'implausible' | 'preview' | 'unknown' | 'error'

export type CandidateProbe = {
  verdict: CandidateVerdict
  contentLength: number | null
  estKbps: number | null
  reason?: string
}

/**
 * 只读响应头探测一个候选 URL —— **不消费 body**。
 *
 * 这是「择优下载」的主判据：`Content-Length ÷ 时长` 就能把真 Hi-Res（2372kbps）、
 * 真无损（933kbps）、谎报的 320k（321kbps）、试听片段（34kbps）干净地分开，
 * 而代价只是一次请求头。
 */
export async function probeCandidate(
  url: string,
  opts: {
    expectedDurationSec: number | null
    quality: string | null
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<CandidateProbe> {
  const timeoutMs = opts.timeoutMs ?? 20000
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  // 传入的 signal 可能**在调用前就已 abort** —— 那种情况下 'abort' 事件不会再触发，
  // 必须主动同步一次，否则探测会照常发起请求（契约要求此时返回 error）
  if (opts.signal?.aborted) onAbort()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'miyin/0.1', Referer: 'https://www.google.com/' },
    })
    // 只读头：立刻取消 body，不下载内容（对照实验：服务端发头不发 body 时也不会挂，20ms 内返回）
    await res.body?.cancel().catch(() => {})
    if (!res.ok) {
      return { verdict: 'error', contentLength: null, estKbps: null, reason: `HTTP ${res.status}` }
    }
    // 压缩传输时 Content-Length 是压缩后大小，不能用来估码率
    const encoding = res.headers.get('content-encoding')
    if (encoding && encoding !== 'identity') {
      return {
        verdict: 'unknown',
        contentLength: null,
        estKbps: null,
        reason: `内容被 ${encoding} 压缩，长度不可用于估码率`,
      }
    }
    const raw = Number(res.headers.get('content-length') || 0)
    const contentLength = raw > 0 ? raw : null
    const estKbps = estimateBitrateKbps(contentLength, opts.expectedDurationSec)
    if (estKbps == null) {
      return {
        verdict: 'unknown',
        contentLength,
        estKbps: null,
        reason: contentLength == null ? '无 Content-Length' : '无已知时长',
      }
    }
    if (estKbps < MIN_KBPS_ANY) {
      return {
        verdict: 'preview',
        contentLength,
        estKbps,
        reason: `估算仅 ${Math.round(estKbps)}kbps，远低于任何档位`,
      }
    }
    const plausibility = qualityPlausibility(estKbps, opts.quality)
    if (plausibility === 'implausible') {
      return {
        verdict: 'implausible',
        contentLength,
        estKbps,
        reason: `估算 ${Math.round(estKbps)}kbps 配不上声称的 ${opts.quality}`,
      }
    }
    return { verdict: plausibility === 'ok' ? 'ok' : 'unknown', contentLength, estKbps }
  } catch (err) {
    return {
      verdict: 'error',
      contentLength: null,
      estKbps: null,
      reason: String((err as Error)?.message || err),
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
