import { importSourcesText } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text?: string; urls?: string[] }>(event)
  const text =
    body?.text ||
    (body?.urls || []).join('\n')
  if (!text?.trim()) throw createError({ statusCode: 400, statusMessage: '请提供 text 或 urls' })
  return await importSourcesText(text)
})
