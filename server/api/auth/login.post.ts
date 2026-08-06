import { createSessionToken, safeEqualString } from '~~/server/utils/crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  const config = useRuntimeConfig()
  const expected = String(config.authToken || '')
  if (!body?.token || !safeEqualString(body.token, expected)) {
    throw createError({ statusCode: 401, statusMessage: '口令错误' })
  }
  const session = createSessionToken(String(config.sessionSecret))
  setCookie(event, 'miyin_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return { ok: true }
})
