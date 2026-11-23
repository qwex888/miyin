export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 全部合法音质档位（入队/重试/换音质共用） */
export const ALLOWED_QUALITIES: readonly string[] = ['highest', 'flac24bit', 'flac', '320k', '128k']

export function isAllowedQuality(quality: string | null | undefined): boolean {
  return !!quality && ALLOWED_QUALITIES.includes(quality)
}

/** 可自动重试的错误（不做断点续传，整文件重下） */
export function isRetryableError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase()
  const code = String((err as any)?.code || '').toUpperCase()
  const retryCodes = new Set([
    'ENOSPC',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ])
  if (retryCodes.has(code)) return true
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return false
  const patterns = [
    'enospc',
    'no space',
    'disk full',
    '磁盘满',
    '空间不足',
    'econnreset',
    'econnrefused',
    'etimedout',
    'network',
    'socket',
    'fetch failed',
    'request timeout',
    '超时',
    '断网',
    'temporarily unavailable',
    'http 5',
    'http 429',
    'too many requests',
  ]
  return patterns.some((p) => msg.includes(p))
}

/**
 * 失败后下一状态：
 * - `autoFailover` 关：一律 failed（连换源都不做，也就不该整轮重跑）
 * - 次数用尽：failed
 * - 同源可重试（网络/磁盘类）**或**还有别的源可换：queued
 * - 其余（这个错换源也没用，且没有备源）：failed
 *
 * 注意 `hasAltSource` 是**独立**的放行条件，不能只挂在 `retryable` 上：
 * 「未登录 / 该源无版权 / 直链 404」这类错误对该源是终态，对别的源未必是。
 * 早期实现先 `if (!retryable) return 'failed'` 短路，`hasAltSource` 永远拿不到
 * 控制权，等于「设置里开着失败自动换源，真到该换源时一步死」。轮次仍由
 * `maxAttempts` 封顶，不会无界空转；本地错误（写入权限等）由调用方排除。
 */
export function nextStatusAfterFailure(opts: {
  attempts: number
  maxAttempts: number
  autoFailover: boolean
  hasAltSource: boolean
  retryable?: boolean
}): TaskStatus {
  const retryable = opts.retryable !== false
  if (!opts.autoFailover) return 'failed'
  if (opts.attempts >= opts.maxAttempts) return 'failed'
  if (retryable || opts.hasAltSource) return 'queued'
  return 'failed'
}
