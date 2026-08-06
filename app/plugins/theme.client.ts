/**
 * 初始化主题（默认系统；有本地偏好则用偏好）。
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return
  const { init } = useTheme()
  init()
})
