export default defineNuxtRouteMiddleware(async (to) => {
  const { refresh, authRequired, loggedIn } = useAuth()
  const ok = await refresh()

  if (to.path === '/login') {
    // 开放模式或已登录：无需停留在登录页
    if (!authRequired.value || loggedIn.value) return navigateTo('/')
    return
  }

  if (!ok) return navigateTo('/login')
})
