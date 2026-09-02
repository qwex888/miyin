import { createSessionToken, SESSION_MAX_AGE_SEC, safeEqualString } from '~~/server/utils/crypto'
import { isAuthRequired } from '~~/server/utils/authMode'
import { getSessionSecret } from '~~/server/utils/runtimeEnv'
import { getEffectiveAuthToken } from '~~/server/services/authTokenService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  const expected = getEffectiveAuthToken()

  if (!isAuthRequired(expected)) {
    throw createError({ statusCode: 400, statusMessage: '当前未启用口令鉴权' })
  }

  if (!body?.token || !safeEqualString(body.token, expected)) {
    throw createError({ statusCode: 401, statusMessage: '口令错误' })
  }
  const session = createSessionToken(getSessionSecret())
  setCookie(event, 'miyin_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  })
  return { ok: true, expiresIn: SESSION_MAX_AGE_SEC }
})
