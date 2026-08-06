import { createSessionToken, SESSION_MAX_AGE_SEC, safeEqualString } from '~~/server/utils/crypto'
import { isAuthRequired } from '~~/server/utils/authMode'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  const config = useRuntimeConfig()
  const expected = String(config.authToken || '')

  if (!isAuthRequired(expected)) {
    throw createError({ statusCode: 400, statusMessage: '当前未启用口令鉴权' })
  }

  if (!body?.token || !safeEqualString(body.token, expected)) {
    throw createError({ statusCode: 401, statusMessage: '口令错误' })
  }
  const session = createSessionToken(String(config.sessionSecret))
  setCookie(event, 'miyin_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  })
  return { ok: true, expiresIn: SESSION_MAX_AGE_SEC }
})
