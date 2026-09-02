import {
  SOURCE_ITEM_TIMEOUT_MS,
  sourceBatchTimeoutMs,
  type SourceProgressPhase,
  type SourceProgressReporter,
} from '#shared/sourceBatchProgress'

export class SourceBatchTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceBatchTimeoutError'
  }
}

export function createBatchDeadline(total: number, itemMs = SOURCE_ITEM_TIMEOUT_MS) {
  const budget = sourceBatchTimeoutMs(total, itemMs)
  const deadline = Date.now() + budget
  return {
    budgetMs: budget,
    isExpired: () => Date.now() >= deadline,
    remainingMs: () => Math.max(0, deadline - Date.now()),
  }
}

export function batchAbortError(message = '用户已停止') {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

export function assertBatchNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw batchAbortError()
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    assertBatchNotAborted(signal)
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SourceBatchTimeoutError(`${label}超时（${Math.round(ms / 1000)}s）`))
        }, ms)
        if (signal) {
          onAbort = () => reject(batchAbortError())
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function reportProgress(
  onProgress: SourceProgressReporter | undefined,
  input: {
    index: number
    total: number
    name: string
    status: SourceProgressPhase
    error?: string
  },
) {
  if (!onProgress) return
  await onProgress(input)
}

export { SOURCE_ITEM_TIMEOUT_MS, sourceBatchTimeoutMs }
