import { verifySession } from '../utils/crypto'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (path === '/api/auth/login' || path === '/api/health') return

  const config = useRuntimeConfig()
  const cookie = getCookie(event, 'miyin_session')
  const header = getHeader(event, 'authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const session = verifySession(cookie || bearer, String(config.sessionSecret))
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: '未登录或会话已过期' })
  }
  event.context.auth = session
})
