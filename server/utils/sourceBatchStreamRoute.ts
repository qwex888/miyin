import type { H3Event } from 'h3'
import type { SourceBatchDoneEvent, SourceBatchHandlers, SourceLogEvent } from '#shared/sourceBatchProgress'
import { batchAbortError } from './sourceBatchTimeout'
import { openNdjsonStream } from './ndjsonStream'

export function bindBatchAbortSignal(event: H3Event): AbortSignal {
  const controller = new AbortController()
  event.node.req.on('close', () => {
    if (!controller.signal.aborted) controller.abort()
  })
  return controller.signal
}

type BatchWorkResult = Omit<SourceBatchDoneEvent, 'type'>

/** 音源批处理 NDJSON 路由：绑定客户端断开为 abort，并统一 done / cancelled / error 事件 */
export function runSourceBatchNdjsonRoute(
  event: H3Event,
  run: (handlers: SourceBatchHandlers) => Promise<BatchWorkResult>,
) {
  const stream = openNdjsonStream(event)
  const signal = bindBatchAbortSignal(event)

  void (async () => {
    try {
      const result = await run({
        signal,
        onProgress: async (p) => {
          await stream.send({ type: 'progress', ...p })
        },
        onLog: async (l: Omit<SourceLogEvent, 'type'>) => {
          await stream.send({ type: 'log', ...l })
        },
      })
      if (signal.aborted || result.cancelled) {
        await stream.send({
          type: 'cancelled',
          message: '用户已停止',
          total: result.total,
          processed: countBatchProcessed(result),
        })
        return
      }
      await stream.send({ type: 'done', ...result })
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string; statusMessage?: string }
      if (e?.name === 'AbortError' || signal.aborted) {
        await stream.send({ type: 'cancelled', message: e?.message || '用户已停止' })
        return
      }
      await stream.send({
        type: 'error',
        message: e?.statusMessage || e?.message || String(err),
      })
    } finally {
      await stream.close()
    }
  })()

  return stream.response
}

function countBatchProcessed(result: BatchWorkResult): number {
  const n =
    (result.imported ?? 0) +
    (result.overwritten ?? 0) +
    (result.skipped ?? 0) +
    (result.failed ?? 0) +
    (result.deleted ?? 0)
  if (n > 0) return n
  if (result.items?.length) return result.items.length
  if (result.results?.length) return result.results.length
  return 0
}

export { batchAbortError }
