export default defineNuxtPlugin(() => {
  const route = useRoute()
  const { checkForUpdate } = useAppUpdate()

  if (route.path === '/login') return

  void checkForUpdate(false)
})
