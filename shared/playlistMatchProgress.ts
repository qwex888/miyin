/** 歌单解析、匹配与入队流式进度事件定义（前后端通用） */

export type PlaylistParseStreamProgressEvent = {
  type: 'parse_progress'
  index: number
  total: number
  title: string
}

export type PlaylistParseStreamDoneEvent = {
  type: 'done'
  platform: string
  title: string
  url: string
  tracks: unknown[]
}

export type PlaylistMatchStreamProgressEvent = {
  type: 'progress'
  index: number
  total: number
  track: {
    title: string
    artist: string
    platform: string
  }
  status: 'matched' | 'need_confirm' | 'manual' | 'failed'
  score: number
  error?: string
}

export type PlaylistMatchStreamDoneEvent = {
  type: 'done'
  total: number
  autoOk: number
  needConfirm: number
  rows: unknown[]
}

export type PlaylistEnqueueStreamProgressEvent = {
  type: 'progress'
  stage: 'parsing' | 'matching' | 'enqueuing'
  index: number
  total: number
  title: string
  ok?: boolean
  error?: string
}

export type PlaylistEnqueueStreamDoneEvent = {
  type: 'done'
  batchId: string
  playlistTitle: string
  total: number
  enqueued: number
  results: Array<{
    title: string
    ok: boolean
    method?: string
    error?: string
    taskId?: string
  }>
}

export type PlaylistStreamErrorEvent = {
  type: 'error'
  message: string
}

export type PlaylistStreamCancelEvent = {
  type: 'cancelled'
  processed: number
  total: number
  message?: string
}

export type PlaylistMatchStreamEvent =
  | { type: 'start'; total: number; stage?: string }
  | PlaylistMatchStreamProgressEvent
  | PlaylistParseStreamProgressEvent
  | PlaylistEnqueueStreamProgressEvent
  | PlaylistMatchStreamDoneEvent
  | PlaylistParseStreamDoneEvent
  | PlaylistEnqueueStreamDoneEvent
  | PlaylistStreamErrorEvent
  | PlaylistStreamCancelEvent
