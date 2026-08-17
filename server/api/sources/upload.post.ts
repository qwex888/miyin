import {
  addSourceFromScript,
  applySourcesFromFiles,
  previewSourcesFromFiles,
} from '~~/server/services/sourceRegistry'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'

function formFlag(form: Awaited<ReturnType<typeof readMultipartFormData>>, name: string) {
  const part = form?.find((p) => p.name === name)
  if (!part?.data) return ''
  return Buffer.from(part.data).toString('utf8').trim()
}

export default defineEventHandler(async (event) => {
  const contentType = getHeader(event, 'content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const form = await readMultipartFormData(event)
    if (!form?.length) {
      throw createError({ statusCode: 400, statusMessage: '未收到上传文件' })
    }
    const files: Array<{ name: string; script: string }> = []
    for (const part of form) {
      if (!part.data?.length) continue
      if (part.name !== 'file' && part.name !== 'files' && part.name !== 'files[]') continue
      if (part.filename && !/\.js$/i.test(part.filename)) continue
      files.push({
        name: (part.filename || 'source.js').replace(/\.js$/i, ''),
        script: Buffer.from(part.data).toString('utf8'),
      })
    }
    if (!files.length) {
      throw createError({ statusCode: 400, statusMessage: '未找到 .js 音源文件' })
    }

    const dryRunRaw = formFlag(form, 'dryRun')
    const dryRun = dryRunRaw === 'true' || dryRunRaw === '1'
    const onConflictRaw = formFlag(form, 'onConflict')
    const streamRaw = formFlag(form, 'stream')

    if (files.length === 1 && !dryRun && !onConflictRaw) {
      const row = await addSourceFromScript({
        name: files[0]!.name,
        script: files[0]!.script,
        renameOnConflict: true,
      })
      return { total: 1, imported: 1, renamed: 0, results: [{ ok: true, source: row }], source: row }
    }

    if (dryRun) {
      return previewSourcesFromFiles(files)
    }

    if (onConflictRaw !== 'overwrite' && onConflictRaw !== 'skip') {
      throw createError({
        statusCode: 400,
        statusMessage: '批量上传需指定 onConflict=overwrite|skip，或先 dryRun 预览',
      })
    }

    if (!wantsSourceBatchStream(event, streamRaw)) {
      return await applySourcesFromFiles(files, onConflictRaw)
    }

    const stream = openNdjsonStream(event)
    void (async () => {
      try {
        const result = await applySourcesFromFiles(files, onConflictRaw, {
          onProgress: async (p) => {
            await stream.send({ type: 'progress', ...p })
          },
        })
        await stream.send({
          type: 'done',
          total: result.total,
          imported: result.imported,
          overwritten: result.overwritten,
          skipped: result.skipped,
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
  }

  const body = await readBody<{ name?: string; script?: string; url?: string }>(event)
  if (!body?.name || !body?.script) {
    throw createError({ statusCode: 400, statusMessage: 'name/script 必填' })
  }
  return await addSourceFromScript({
    name: body.name,
    script: body.script,
    url: body.url,
    renameOnConflict: true,
  })
})
