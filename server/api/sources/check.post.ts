import { checkSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[] }>(event)
  return { items: await checkSources(body?.ids) }
})
