import { verifySession } from '~~/server/utils/crypto'
import { isAuthRequired } from '~~/server/utils/authMode'
import { getSessionSecret } from '~~/server/utils/runtimeEnv'
import { getAuthTokenStatus, getEffectiveAuthToken } from '~~/server/services/authTokenService'

export default defineEventHandler((event) => {
  const authToken = getEffectiveAuthToken()
  const authRequired = isAuthRequired(authToken)
  const status = getAuthTokenStatus()
  if (!authRequired) {
    return {
      ok: true,
      authRequired: false,
      loggedIn: true,
      user: 'open',
      authSource: status.source,
      authRuntime: status.runtime,
    }
  }

  const cookie = getCookie(event, 'miyin_session')
  const header = getHeader(event, 'authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const session = verifySession(cookie || bearer, getSessionSecret())
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: '未登录或会话已过期' })
  }
  return {
    ok: true,
    authRequired: true,
    loggedIn: true,
    user: 'admin',
    authSource: status.source,
    authRuntime: status.runtime,
  }
})
