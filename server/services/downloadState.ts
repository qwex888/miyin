export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 状态机辅助（单测用） */
export function nextStatusAfterFailure(opts: {
  attempts: number
  maxAttempts: number
  autoFailover: boolean
  hasAltSource: boolean
}): TaskStatus {
  if (opts.autoFailover && opts.attempts < opts.maxAttempts && opts.hasAltSource) return 'queued'
  return 'failed'
}
