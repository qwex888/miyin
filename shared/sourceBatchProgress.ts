/** 音源批处理实时进度（前后端共用） */

export const SOURCE_ITEM_TIMEOUT_MS = 30_000
export const SOURCE_BATCH_TIMEOUT_CAP_MS = 5 * 60_000

export type SourceProgressPhase =
  | 'loading'
  | 'configuring'
  | 'checking'
  | 'done'
  | 'skipped'
  | 'failed'

export const SOURCE_PROGRESS_PHASE_LABEL: Record<SourceProgressPhase, string> = {
  loading: '加载中',
  configuring: '配置中',
  checking: '检测中',
  done: '完成',
  skipped: '已跳过',
  failed: '失败',
}

export type SourceProgressEvent = {
  type: 'progress'
  index: number
  total: number
  name: string
  status: SourceProgressPhase
  error?: string
}

export type SourceBatchDoneEvent = {
  type: 'done'
  total: number
  imported?: number
  overwritten?: number
  skipped?: number
  renamed?: number
  failed?: number
  deleted?: number
  timedOut?: boolean
  items?: Array<{ id: string; status: string; error?: string }>
  results?: Array<Record<string, unknown>>
}

export type SourceBatchErrorEvent = {
  type: 'error'
  message: string
}

export type SourceBatchStreamEvent =
  | SourceProgressEvent
  | SourceBatchDoneEvent
  | SourceBatchErrorEvent
  | { type: 'start'; total: number }

export type SourceProgressReporter = (event: {
  index: number
  total: number
  name: string
  status: SourceProgressPhase
  error?: string
}) => void | Promise<void>

export function sourceBatchTimeoutMs(total: number, itemMs = SOURCE_ITEM_TIMEOUT_MS): number {
  const n = Math.max(0, Math.floor(total))
  return Math.min(SOURCE_BATCH_TIMEOUT_CAP_MS, n * itemMs)
}

export function formatSourceProgressText(input: {
  index: number
  total: number
  name: string
  status: SourceProgressPhase
}): string {
  const label = SOURCE_PROGRESS_PHASE_LABEL[input.status] || input.status
  return `当前进度：【${input.index}/${input.total}】音源：[${input.name}]，状态：${label}`
}
