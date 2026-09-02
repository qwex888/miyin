import { applySourcesBundle, previewSourcesBundle } from '~~/server/services/sourceBundle'
import { wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import { runSourceBatchNdjsonRoute } from '~~/server/utils/sourceBatchStreamRoute'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) {
    throw createError({ statusCode: 400, statusMessage: '请上传完整包 zip 文件' })
  }

  const filePart = form.find((p) => p.name === 'file' && p.data?.length)
  if (!filePart?.data?.length) {
    throw createError({ statusCode: 400, statusMessage: '请上传完整包 zip 文件' })
  }

  const dryRunPart = form.find((p) => p.name === 'dryRun')
  const onConflictPart = form.find((p) => p.name === 'onConflict')
  const streamPart = form.find((p) => p.name === 'stream')
  const dryRun =
    String(dryRunPart?.data ? Buffer.from(dryRunPart.data).toString('utf8') : '')
      .trim()
      .toLowerCase() === 'true' ||
    String(dryRunPart?.data ? Buffer.from(dryRunPart.data).toString('utf8') : '').trim() === '1'

  const onConflictRaw = String(
    onConflictPart?.data ? Buffer.from(onConflictPart.data).toString('utf8') : '',
  )
    .trim()
    .toLowerCase()

  const streamRaw = String(streamPart?.data ? Buffer.from(streamPart.data).toString('utf8') : '')
    .trim()
    .toLowerCase()

  const zipBuffer = Buffer.from(filePart.data)

  if (dryRun) {
    return { dryRun: true, ...previewSourcesBundle(zipBuffer) }
  }

  if (onConflictRaw !== 'overwrite' && onConflictRaw !== 'skip') {
    const preview = previewSourcesBundle(zipBuffer)
    if (preview.conflictCount > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: `发现 ${preview.conflictCount} 个冲突，请选择覆盖或跳过`,
        data: preview,
      })
    }
    if (!wantsSourceBatchStream(event, streamRaw)) {
      return await applySourcesBundle(zipBuffer, 'skip')
    }
  }

  const conflict = (onConflictRaw === 'overwrite' || onConflictRaw === 'skip'
    ? onConflictRaw
    : 'skip') as 'overwrite' | 'skip'

  if (!wantsSourceBatchStream(event, streamRaw)) {
    return await applySourcesBundle(zipBuffer, conflict)
  }

  return runSourceBatchNdjsonRoute(event, (handlers) =>
    applySourcesBundle(zipBuffer, conflict, handlers),
  )
})
