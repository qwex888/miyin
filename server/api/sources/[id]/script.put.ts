import {
  refreshSourceScriptFromUrl,
  saveSourceScript,
} from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const body = await readBody<{ script?: string; name?: string; refreshFromUrl?: boolean }>(event)

  if (body?.refreshFromUrl) {
    return await refreshSourceScriptFromUrl(id)
  }

  if (body?.script == null) {
    throw createError({ statusCode: 400, statusMessage: '请提供 script 或 refreshFromUrl' })
  }

  return await saveSourceScript(id, { script: body.script, name: body.name })
})
