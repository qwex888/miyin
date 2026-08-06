import { deleteSource, getSource } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[] }>(event)
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : []
  if (!ids.length) {
    throw createError({ statusCode: 400, statusMessage: '请提供要删除的音源 ids' })
  }

  const deleted: string[] = []
  const missing: string[] = []
  for (const id of ids) {
    if (!getSource(id)) {
      missing.push(id)
      continue
    }
    deleteSource(id)
    deleted.push(id)
  }

  return { deleted: deleted.length, missing, ids: deleted }
})
