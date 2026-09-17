import { shouldRunBootUpdateCheck } from '#shared/appUpdate'

export default defineNuxtPlugin(() => {
  const route = useRoute()
  const { checkForUpdate } = useAppUpdate()
  const { loggedIn, authRequired, refresh } = useAuth()
  const bootStarted = useState('app-update:boot-started', () => false)

  async function tryBootCheck() {
    if (bootStarted.value) return
    if (
      !shouldRunBootUpdateCheck({
        path: route.path,
        authRequired: authRequired.value,
        loggedIn: loggedIn.value,
      })
    ) {
      return
    }
    bootStarted.value = true
    void checkForUpdate(false)
  }

  // 等鉴权态就绪后再检查；覆盖「已登录直进」与「登录成功后离开 /login」
  watch(
    [() => route.path, loggedIn, authRequired],
    () => {
      void tryBootCheck()
    },
  )

  void (async () => {
    await refresh()
    await tryBootCheck()
  })()
})
