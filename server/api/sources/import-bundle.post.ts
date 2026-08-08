import { applySourcesBundle, previewSourcesBundle } from '~~/server/services/sourceBundle'

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
    return await applySourcesBundle(zipBuffer, 'skip')
  }

  return await applySourcesBundle(zipBuffer, onConflictRaw as 'overwrite' | 'skip')
})
