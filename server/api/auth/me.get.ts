import { verifySession } from '~~/server/utils/crypto'
import { isAuthRequired } from '~~/server/utils/authMode'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const authRequired = isAuthRequired(config.authToken)
  if (!authRequired) {
    return { ok: true, authRequired: false, loggedIn: true, user: 'open' }
  }

  const cookie = getCookie(event, 'miyin_session')
  const header = getHeader(event, 'authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const session = verifySession(cookie || bearer, String(config.sessionSecret))
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: '未登录或会话已过期' })
  }
  return { ok: true, authRequired: true, loggedIn: true, user: 'admin' }
})
