import { checkSources } from '~~/server/services/sourceRegistry'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; stream?: boolean | string }>(event)

  if (!wantsSourceBatchStream(event, body?.stream)) {
    const result = await checkSources(body?.ids)
    return { items: result.items, timedOut: result.timedOut, total: result.total }
  }

  const stream = openNdjsonStream(event)
  void (async () => {
    try {
      const result = await checkSources(body?.ids, {
        onProgress: async (p) => {
          await stream.send({ type: 'progress', ...p })
        },
        onLog: async (l) => {
          await stream.send({ type: 'log', ...l })
        },
      })
      await stream.send({
        type: 'done',
        total: result.total,
        items: result.items,
        timedOut: result.timedOut,
      })
    } catch (err: any) {
      await stream.send({
        type: 'error',
        message: err?.statusMessage || err?.message || String(err),
      })
    } finally {
      await stream.close()
    }
  })()
  return stream.response
})
