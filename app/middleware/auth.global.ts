export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const { refresh } = useAuth()
  const ok = await refresh()
  if (!ok) return navigateTo('/login')
})
