export function useAuth() {
  const loggedIn = useState('auth:loggedIn', () => false)

  async function refresh() {
    try {
      // SSR 时转发浏览器 Cookie，避免刷新后误判未登录
      const requestFetch = useRequestFetch()
      await requestFetch('/api/auth/me')
      loggedIn.value = true
      return true
    } catch {
      loggedIn.value = false
      return false
    }
  }

  async function login(token: string) {
    const requestFetch = useRequestFetch()
    await requestFetch('/api/auth/login', { method: 'POST', body: { token } })
    loggedIn.value = true
  }

  async function logout() {
    try {
      const requestFetch = useRequestFetch()
      await requestFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      loggedIn.value = false
      await navigateTo('/login')
    }
  }

  return { loggedIn, refresh, login, logout }
}
