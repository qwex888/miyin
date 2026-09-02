import { importSourcesText } from '~~/server/services/sourceRegistry'
import { wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import { runSourceBatchNdjsonRoute } from '~~/server/utils/sourceBatchStreamRoute'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text?: string; urls?: string[]; stream?: boolean | string }>(event)
  const text = body?.text || (body?.urls || []).join('\n')
  if (!text?.trim()) throw createError({ statusCode: 400, statusMessage: '请提供 text 或 urls' })

  if (!wantsSourceBatchStream(event, body?.stream)) {
    return await importSourcesText(text)
  }

  return runSourceBatchNdjsonRoute(event, (handlers) => importSourcesText(text, handlers))
})
