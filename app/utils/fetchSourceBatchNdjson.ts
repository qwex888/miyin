import {
  formatSourceProgressText,
  type SourceBatchDoneEvent,
  type SourceBatchStreamEvent,
  type SourceLogEvent,
  type SourceProgressPhase,
} from '#shared/sourceBatchProgress'

function apiUrl(path: string) {
  const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}${path.replace(/^\//, '')}`
}

function parseNdjsonLine(line: string): SourceBatchStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as SourceBatchStreamEvent
  } catch {
    return null
  }
}

export type SourceBatchNdjsonHandlers = {
  onProgress?: (
    text: string,
    event: Extract<SourceBatchStreamEvent, { type: 'progress' }>,
  ) => void
  onLog?: (event: SourceLogEvent) => void
}

export type SourceBatchNdjsonOptions = {
  handlers?: SourceBatchNdjsonHandlers
  signal?: AbortSignal
}

export async function fetchSourceBatchNdjson(
  path: string,
  init: RequestInit,
  onProgressOrHandlers:
    | ((text: string, event: Extract<SourceBatchStreamEvent, { type: 'progress' }>) => void)
    | SourceBatchNdjsonHandlers,
  options?: SourceBatchNdjsonOptions,
): Promise<SourceBatchDoneEvent> {
  const handlers: SourceBatchNdjsonHandlers =
    typeof onProgressOrHandlers === 'function'
      ? { onProgress: onProgressOrHandlers }
      : onProgressOrHandlers
  const signal = options?.signal ?? init.signal ?? undefined

  const res = await fetch(apiUrl(path), {
    ...init,
    signal,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/x-ndjson',
      ...(init.headers || {}),
    },
  })

  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { statusMessage?: string; message?: string }
      message = data.statusMessage || data.message || message
    } catch {
      try {
        message = (await res.text()) || message
      } catch {
        /* ignore */
      }
    }
    throw new Error(message)
  }

  if (!res.body) {
    throw new Error('响应无可读内容')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let doneEvent: SourceBatchDoneEvent | null = null

  const handleEvent = (event: SourceBatchStreamEvent) => {
    if (event.type === 'progress') {
      handlers.onProgress?.(
        formatSourceProgressText({
          index: event.index,
          total: event.total,
          name: event.name,
          status: event.status as SourceProgressPhase,
        }),
        event,
      )
      return
    }
    if (event.type === 'log') {
      handlers.onLog?.(event)
      return
    }
    if (event.type === 'done') {
      doneEvent = event
      return
    }
    if (event.type === 'cancelled') {
      const err = new Error(event.message || '用户已停止')
      err.name = 'AbortError'
      throw err
    }
    if (event.type === 'error') {
      throw new Error(event.message || '批处理失败')
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {})
        const err = new Error('用户已停止')
        err.name = 'AbortError'
        throw err
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const event = parseNdjsonLine(line)
        if (event) handleEvent(event)
      }
    }

    const tail = parseNdjsonLine(buffer)
    if (tail) handleEvent(tail)
  } catch (err: unknown) {
    await reader.cancel().catch(() => {})
    throw err
  }

  if (!doneEvent) {
    if (signal?.aborted) {
      const err = new Error('用户已停止')
      err.name = 'AbortError'
      throw err
    }
    throw new Error('批处理未返回完成结果')
  }
  return doneEvent
}

export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  return e?.name === 'AbortError' || /用户已停止|aborted/i.test(String(e?.message || ''))
}
