import { enqueueDownload } from '~~/server/services/downloadQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.title || !body?.artist || !body?.platform || !body?.musicInfo) {
    throw createError({ statusCode: 400, statusMessage: '缺少必要字段' })
  }
  return enqueueDownload(body)
})
