import { createSessionToken, SESSION_MAX_AGE_SEC, safeEqualString } from '~~/server/utils/crypto'

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
    maxAge: SESSION_MAX_AGE_SEC,
    // 本地 http 开发不强制 secure；生产 https 由浏览器按站点策略处理
  })
  return { ok: true, expiresIn: SESSION_MAX_AGE_SEC }
})
