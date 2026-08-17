import {
  formatSourceProgressText,
  type SourceBatchDoneEvent,
  type SourceBatchStreamEvent,
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

export async function fetchSourceBatchNdjson(
  path: string,
  init: RequestInit,
  onProgress: (text: string, event: Extract<SourceBatchStreamEvent, { type: 'progress' }>) => void,
): Promise<SourceBatchDoneEvent> {
  const res = await fetch(apiUrl(path), {
    ...init,
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
      onProgress(
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
    if (event.type === 'done') {
      doneEvent = event
      return
    }
    if (event.type === 'error') {
      throw new Error(event.message || '批处理失败')
    }
  }

  while (true) {
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

  if (!doneEvent) {
    throw new Error('批处理未返回完成结果')
  }
  return doneEvent
}
