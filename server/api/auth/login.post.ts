import { createSessionToken, SESSION_MAX_AGE_SEC, safeEqualString } from '~~/server/utils/crypto'
import { isAuthRequired } from '~~/server/utils/authMode'
import { getSessionSecret } from '~~/server/utils/runtimeEnv'
import { getEffectiveAuthToken } from '~~/server/services/authTokenService'
import { appError } from '~~/server/utils/appError'
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from '~~/server/utils/loginThrottle'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  const expected = getEffectiveAuthToken()

  if (!isAuthRequired(expected)) {
    throw appError({ statusCode: 400, message: '当前未启用口令鉴权' })
  }

  // 按 socket 地址限流（不读 x-forwarded-for，避免伪造头绕过）。
  // 放在口令比较之前：被限流时连比较都不做，省掉无意义的常数时间比较。
  const ip = getRequestIP(event) || event.node.req.socket?.remoteAddress || 'unknown'
  const gate = checkLoginAllowed(ip)
  if (!gate.allowed) {
    setHeader(event, 'Retry-After', String(gate.retryAfterSec))
    throw appError({
      statusCode: 429,
      message: gate.locked
        ? `口令错误次数过多，请 ${Math.ceil(gate.retryAfterSec / 60)} 分钟后再试`
        : `尝试过于频繁，请 ${gate.retryAfterSec} 秒后再试`,
      data: { code: 'LOGIN_THROTTLED', retryAfterSec: gate.retryAfterSec, locked: gate.locked },
    })
  }

  if (!body?.token || !safeEqualString(body.token, expected)) {
    recordLoginFailure(ip)
    throw appError({ statusCode: 401, message: '口令错误' })
  }

  recordLoginSuccess(ip)
  const session = createSessionToken(getSessionSecret())
  setCookie(event, 'miyin_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  })
  return { ok: true, expiresIn: SESSION_MAX_AGE_SEC }
})
