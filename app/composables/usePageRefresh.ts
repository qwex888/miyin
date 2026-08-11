/**
 * 页面刷新：KeepAlive 保留会话操作态；用户点刷新时按「进入页」逻辑重新拉数。
 * 各页注册 handler；顶栏按当前路由调用。
 */

type RefreshHandler = () => void | Promise<void>

const handlers = new Map<string, RefreshHandler>()

function routeKey(path: string) {
  return path || '/'
}

/**
 * 在页面 setup 中调用：注册当前页的刷新逻辑（与 onMounted 进入时一致）。
 * KeepAlive 下 onActivated 会重新占位，避免切走后仍误绑旧页。
 */
export function useRegisterPageRefresh(handler: RefreshHandler) {
  const route = useRoute()

  function register() {
    handlers.set(routeKey(route.path), handler)
  }

  function unregister() {
    const key = routeKey(route.path)
    if (handlers.get(key) === handler) handlers.delete(key)
  }

  onMounted(register)
  onActivated(register)
  onDeactivated(unregister)
  onBeforeUnmount(unregister)
}

export function usePageRefreshAction() {
  const route = useRoute()
  const toast = useToast()
  const busy = ref(false)

  const canRefresh = computed(() => handlers.has(routeKey(route.path)))

  async function refreshCurrentPage() {
    const fn = handlers.get(routeKey(route.path))
    if (!fn || busy.value) return
    busy.value = true
    try {
      await fn()
      toast.success('已刷新')
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, '刷新失败'))
    } finally {
      busy.value = false
    }
  }

  return { canRefresh, busy, refreshCurrentPage }
}
