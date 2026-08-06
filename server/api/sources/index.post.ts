import { addSource } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string; url: string; mirrorUrl?: string }>(event)
  if (!body?.name || !body?.url) {
    throw createError({ statusCode: 400, statusMessage: 'name/url 必填' })
  }
  return await addSource(body)
})
