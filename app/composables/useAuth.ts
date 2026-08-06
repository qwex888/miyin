export function useAuth() {
  const loggedIn = useState('auth:loggedIn', () => false)

  async function refresh() {
    try {
      await $fetch('/api/auth/me')
      loggedIn.value = true
      return true
    } catch {
      loggedIn.value = false
      return false
    }
  }

  async function login(token: string) {
    await $fetch('/api/auth/login', { method: 'POST', body: { token } })
    loggedIn.value = true
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      loggedIn.value = false
      await navigateTo('/login')
    }
  }

  return { loggedIn, refresh, login, logout }
}
