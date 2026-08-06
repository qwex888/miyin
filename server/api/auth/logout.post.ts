export default defineEventHandler((event) => {
  deleteCookie(event, 'miyin_session', { path: '/' })
  return { ok: true }
})
