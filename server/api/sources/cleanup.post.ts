import { cleanupDeadSources } from '~~/server/services/sourceRegistry'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ dryRun?: boolean; stream?: boolean | string }>(event)
  const dryRun = !!body?.dryRun

  if (dryRun || !wantsSourceBatchStream(event, body?.stream)) {
    return await cleanupDeadSources(dryRun)
  }

  const stream = openNdjsonStream(event)
  void (async () => {
    try {
      const result = await cleanupDeadSources(false, {
        onProgress: async (p) => {
          await stream.send({ type: 'progress', ...p })
        },
      })
      await stream.send({
        type: 'done',
        total: result.total ?? result.count,
        deleted: result.deleted ?? result.count,
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
