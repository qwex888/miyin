import type { H3Event } from 'h3'
import { sendStream, setResponseHeaders } from 'h3'
import type { SourceBatchStreamEvent } from '#shared/sourceBatchProgress'

export function wantsSourceBatchStream(event: H3Event, bodyStream?: unknown): boolean {
  const q = getQuery(event)
  if (q.stream === '1' || q.stream === 'true') return true
  if (bodyStream === true || bodyStream === 'true' || bodyStream === '1') return true
  const accept = getHeader(event, 'accept') || ''
  return accept.includes('application/x-ndjson')
}

/** 打开 NDJSON 响应流；调用方需在后台写完后 close */
export function openNdjsonStream(event: H3Event) {
  setResponseHeaders(event, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  })

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  let closed = false

  const send = async (payload: SourceBatchStreamEvent) => {
    if (closed) return
    await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`))
  }

  const close = async () => {
    if (closed) return
    closed = true
    try {
      await writer.close()
    } catch {
      /* ignore */
    }
  }

  return {
    response: sendStream(event, readable),
    send,
    close,
  }
}

export async function runNdjsonBatch(
  event: H3Event,
  work: (send: (payload: SourceBatchStreamEvent) => Promise<void>) => Promise<SourceBatchStreamEvent>,
) {
  const stream = openNdjsonStream(event)
  const run = (async () => {
    try {
      const done = await work(stream.send)
      if (done.type === 'done' || done.type === 'error') {
        await stream.send(done)
      }
    } catch (err: any) {
      await stream.send({
        type: 'error',
        message: err?.statusMessage || err?.message || String(err),
      })
    } finally {
      await stream.close()
    }
  })()
  void run
  return stream.response
}
