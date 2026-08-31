import type {
  PlaylistMatchStreamDoneEvent,
  PlaylistMatchStreamEvent,
  PlaylistMatchStreamProgressEvent,
  PlaylistParseStreamDoneEvent,
  PlaylistParseStreamProgressEvent,
  PlaylistEnqueueStreamDoneEvent,
  PlaylistEnqueueStreamProgressEvent,
} from '#shared/playlistMatchProgress'

function apiUrl(path: string) {
  const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}${path.replace(/^\//, '')}`
}

function parseNdjsonLine(line: string): PlaylistMatchStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as PlaylistMatchStreamEvent
  } catch {
    return null
  }
}

async function streamNdjson<T>(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: PlaylistMatchStreamEvent) => void,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({
      ...body,
      stream: true,
    }),
    signal,
  })

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { statusMessage?: string; message?: string }
      if (j?.statusMessage) msg = j.statusMessage
      else if (j?.message) msg = j.message
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }

  if (!res.body) {
    throw new Error('响应无可读内容')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let doneResult: T | null = null

  const handleEvent = (event: PlaylistMatchStreamEvent) => {
    if (event.type === 'done') {
      doneResult = event as unknown as T
    } else if (event.type === 'cancelled') {
      const err = new Error(event.message || '操作已取消')
      err.name = 'AbortError'
      throw err
    } else if (event.type === 'error') {
      throw new Error(event.message)
    }
    onEvent(event)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const ev = parseNdjsonLine(line)
      if (ev) handleEvent(ev)
    }
  }

  const tail = parseNdjsonLine(buffer)
  if (tail) handleEvent(tail)

  if (!doneResult) {
    throw new Error('请求过程未返回完成结果')
  }
  return doneResult
}

export type PlaylistParseHandlers = {
  signal?: AbortSignal
  onProgress?: (event: PlaylistParseStreamProgressEvent) => void
}

export async function fetchPlaylistParseNdjson(
  body: { url: string },
  handlers?: PlaylistParseHandlers,
): Promise<PlaylistParseStreamDoneEvent> {
  return await streamNdjson<PlaylistParseStreamDoneEvent>(
    apiUrl('/api/playlist/parse'),
    body,
    (event) => {
      if (event.type === 'parse_progress') {
        handlers?.onProgress?.(event)
      }
    },
    handlers?.signal,
  )
}

export type PlaylistMatchHandlers = {
  signal?: AbortSignal
  onStart?: (total: number) => void
  onProgress?: (event: PlaylistMatchStreamProgressEvent) => void
}

export async function fetchPlaylistMatchNdjson(
  body: {
    tracks: unknown[]
    scoreThreshold?: number
    concurrency?: number
    allowManualBypass?: boolean
  },
  handlers?: PlaylistMatchHandlers,
): Promise<PlaylistMatchStreamDoneEvent> {
  return await streamNdjson<PlaylistMatchStreamDoneEvent>(
    apiUrl('/api/playlist/match'),
    body,
    (event) => {
      if (event.type === 'start') {
        handlers?.onStart?.(event.total)
      } else if (event.type === 'progress') {
        handlers?.onProgress?.(event as PlaylistMatchStreamProgressEvent)
      }
    },
    handlers?.signal,
  )
}

export type PlaylistEnqueueHandlers = {
  signal?: AbortSignal
  onStart?: (total: number, stage?: string) => void
  onParseProgress?: (event: PlaylistParseStreamProgressEvent) => void
  onProgress?: (event: PlaylistEnqueueStreamProgressEvent) => void
}

export async function fetchPlaylistEnqueueNdjson(
  body: {
    url?: string
    title?: string
    platform?: string
    tracks?: unknown[]
    quality?: string
    downloadLyric?: boolean
    lyricMode?: 'external' | 'embedded'
    concurrency?: number
  },
  handlers?: PlaylistEnqueueHandlers,
): Promise<PlaylistEnqueueStreamDoneEvent> {
  return await streamNdjson<PlaylistEnqueueStreamDoneEvent>(
    apiUrl('/api/playlist/enqueue'),
    body,
    (event) => {
      if (event.type === 'start') {
        handlers?.onStart?.(event.total, event.stage)
      } else if (event.type === 'parse_progress') {
        handlers?.onParseProgress?.(event)
      } else if (event.type === 'progress') {
        handlers?.onProgress?.(event as PlaylistEnqueueStreamProgressEvent)
      }
    },
    handlers?.signal,
  )
}
