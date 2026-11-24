import { verifySession } from '../utils/crypto'
import { isAuthRequired } from '../utils/authMode'
import { getSessionSecret } from '../utils/runtimeEnv'
import { relativeRequestPath } from '../utils/requestPath'
import { getEffectiveAuthToken } from '../services/authTokenService'
import { appError } from '../utils/appError'

export default defineEventHandler((event) => {
  // 必须用「相对应用根」的路径：飞牛 baseURL 下 getRequestURL().pathname 带前缀，
  // 用它判 /api/ 会让整站接口免鉴权（详见 utils/requestPath.ts）
  const path = relativeRequestPath(event)
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
    throw appError({ statusCode: 401, message: '未登录或会话已过期' })
  }
  event.context.auth = session
})
