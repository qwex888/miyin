import { verifySession } from '../utils/crypto'
import { isAuthRequired } from '../utils/authMode'
import { getSessionSecret } from '../utils/runtimeEnv'
import { getEffectiveAuthToken } from '../services/authTokenService'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (path === '/api/auth/login' || path === '/api/auth/me' || path === '/api/health') return

  const authToken = getEffectiveAuthToken()
  if (!isAuthRequired(authToken)) {
    event.context.auth = { open: true }
    return
  }

  const cookie = getCookie(event, 'miyin_session')
  const header = getHeader(event, 'authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const session = verifySession(cookie || bearer, getSessionSecret())
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: '未登录或会话已过期' })
  }
  event.context.auth = session
})
