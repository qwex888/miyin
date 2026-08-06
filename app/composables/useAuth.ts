export function useAuth() {
  const loggedIn = useState('auth:loggedIn', () => false)
  const authRequired = useState('auth:required', () => true)

  async function refresh() {
    try {
      const requestFetch = useRequestFetch()
      const res = await requestFetch<{ ok: boolean; authRequired?: boolean; loggedIn?: boolean }>(
        '/api/auth/me',
      )
      authRequired.value = res.authRequired !== false
      loggedIn.value = true
      return true
    } catch {
      // me 仅在「需要鉴权且未登录」时 401；开放模式总会 ok
      authRequired.value = true
      loggedIn.value = false
      return false
    }
  }

  async function login(token: string) {
    const requestFetch = useRequestFetch()
    await requestFetch('/api/auth/login', { method: 'POST', body: { token } })
    authRequired.value = true
    loggedIn.value = true
  }

  async function logout() {
    try {
      const requestFetch = useRequestFetch()
      await requestFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      loggedIn.value = false
      if (authRequired.value) await navigateTo('/login')
      else await navigateTo('/')
    }
  }

  return { loggedIn, authRequired, refresh, login, logout }
}
