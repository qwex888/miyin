import { checkSources } from '~~/server/services/sourceRegistry'
import { wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import { runSourceBatchNdjsonRoute } from '~~/server/utils/sourceBatchStreamRoute'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[]; stream?: boolean | string }>(event)

  if (!wantsSourceBatchStream(event, body?.stream)) {
    const result = await checkSources(body?.ids)
    return { items: result.items, timedOut: result.timedOut, total: result.total }
  }

  return runSourceBatchNdjsonRoute(event, (handlers) => checkSources(body?.ids, handlers))
})
