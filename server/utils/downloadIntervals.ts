/**
 * 计算距离允许启动下一下载任务还需等待的毫秒数。
 * - taskStartInterval：相对上次「开始」任务
 * - downloadInterval：相对上次「结束」任务（成功/失败/取消均算）
 */
export function msUntilCanStartTask(opts: {
  now: number
  lastStartedAt: number | null
  lastFinishedAt: number | null
  taskStartIntervalSec: number
  downloadIntervalSec: number
}): number {
  let wait = 0
  const startSec = Math.max(0, opts.taskStartIntervalSec || 0)
  const doneSec = Math.max(0, opts.downloadIntervalSec || 0)

  if (startSec > 0 && opts.lastStartedAt != null) {
    wait = Math.max(wait, opts.lastStartedAt + startSec * 1000 - opts.now)
  }
  if (doneSec > 0 && opts.lastFinishedAt != null) {
    wait = Math.max(wait, opts.lastFinishedAt + doneSec * 1000 - opts.now)
  }
  return Math.max(0, Math.ceil(wait))
}
