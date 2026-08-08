import { addSourceFromScript, addSourcesFromFiles } from '~~/server/services/sourceRegistry'

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
      const filename = part.filename || 'source.js'
      if (!/\.js$/i.test(filename) && part.type && !part.type.includes('javascript') && !part.type.includes('text')) {
        // 仍允许无扩展名但内容当脚本；目录上传一般有 .js
      }
      if (part.filename && !/\.js$/i.test(part.filename)) continue
      files.push({
        name: (part.filename || 'source.js').replace(/\.js$/i, ''),
        script: Buffer.from(part.data).toString('utf8'),
      })
    }
    if (!files.length) {
      throw createError({ statusCode: 400, statusMessage: '未找到 .js 音源文件' })
    }
    if (files.length === 1) {
      const row = await addSourceFromScript({
        name: files[0]!.name,
        script: files[0]!.script,
      })
      return { total: 1, imported: 1, renamed: 0, results: [{ ok: true, source: row }], source: row }
    }
    return await addSourcesFromFiles(files)
  }

  const body = await readBody<{ name?: string; script?: string; url?: string }>(event)
  if (!body?.name || !body?.script) {
    throw createError({ statusCode: 400, statusMessage: 'name/script 必填' })
  }
  return await addSourceFromScript({
    name: body.name,
    script: body.script,
    url: body.url,
  })
})
