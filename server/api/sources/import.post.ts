import { importSourcesText } from '~~/server/services/sourceRegistry'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text?: string; urls?: string[]; stream?: boolean | string }>(event)
  const text = body?.text || (body?.urls || []).join('\n')
  if (!text?.trim()) throw createError({ statusCode: 400, statusMessage: '请提供 text 或 urls' })

  if (!wantsSourceBatchStream(event, body?.stream)) {
    return await importSourcesText(text)
  }

  const stream = openNdjsonStream(event)
  void (async () => {
    try {
      const result = await importSourcesText(text, {
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
        imported: result.imported,
        skipped: result.skipped,
        renamed: result.renamed,
        failed: result.failed,
        timedOut: result.timedOut,
        results: result.results,
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
