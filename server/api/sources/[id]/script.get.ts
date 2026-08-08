import { readSourceScript } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  const script = readSourceScript(id)
  return { id, script }
})
