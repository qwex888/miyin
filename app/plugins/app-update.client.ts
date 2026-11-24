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

  // 水合完成前不能改会被 SSR 渲染的状态：checking 一旦提前变 true，
  // 设置页「检查更新」按钮的首帧文案/disabled 就与服务端 HTML 不一致（hydration mismatch）。
  let hydrated = false

  // 等鉴权态就绪后再检查；覆盖「已登录直进」与「登录成功后离开 /login」
  watch(
    [() => route.path, loggedIn, authRequired],
    () => {
      if (hydrated) void tryBootCheck()
    },
  )

  onNuxtReady(async () => {
    hydrated = true
    await refresh()
    await tryBootCheck()
  })
})
