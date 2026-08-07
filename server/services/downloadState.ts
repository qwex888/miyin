export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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
 * - 可重试且未超次数：queued（有备源则换源，无备源也可同源重试）
 * - 否则 failed
 */
export function nextStatusAfterFailure(opts: {
  attempts: number
  maxAttempts: number
  autoFailover: boolean
  hasAltSource: boolean
  retryable?: boolean
}): TaskStatus {
  const retryable = opts.retryable !== false
  if (!retryable) return 'failed'
  if (!opts.autoFailover) return 'failed'
  if (opts.attempts >= opts.maxAttempts) return 'failed'
  // 有备源或同源可重试（网络/磁盘类）都回队列
  if (opts.hasAltSource || retryable) return 'queued'
  return 'failed'
}
