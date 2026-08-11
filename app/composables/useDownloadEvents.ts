type DownloadTaskLite = {
  id: string
  status: string
  progress?: number
  title?: string
  artist?: string
  [key: string]: unknown
}

const ACTIVE = new Set(['queued', 'running'])

type TaskHandler = (task: DownloadTaskLite) => void
type SnapshotHandler = (items: DownloadTaskLite[]) => void

type SseRuntime = {
  es: EventSource | null
  pollTimer: ReturnType<typeof setInterval> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  errorSince: number | null
  watching: boolean
  taskHandlers: Set<TaskHandler>
  snapshotHandlers: Set<SnapshotHandler>
  onlineBound: boolean
  changedBound: boolean
}

const POLL_AFTER_MS = 8000
const RECONNECT_MS = 2000
const GLOBAL_KEY = '__miyinDownloadSse__'

/** 挂在 globalThis，避免 HMR/多入口各持一份模块状态导致双开 SSE */
function runtime(): SseRuntime {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: SseRuntime }
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      es: null,
      pollTimer: null,
      reconnectTimer: null,
      errorSince: null,
      watching: false,
      taskHandlers: new Set(),
      snapshotHandlers: new Set(),
      onlineBound: false,
      changedBound: false,
    }
  }
  return g[GLOBAL_KEY]!
}

/**
 * 全局下载队列 SSE：整站唯一一条 EventSource。
 * 顶栏角标与队列页只订阅，不再各自建连。
 */
export function useDownloadEvents() {
  const activeCount = useState('download-active-count', () => 0)
  const cache = useState<DownloadTaskLite[]>('download-badge-cache', () => [])
  const connected = useState('download-sse-connected', () => false)
  const rt = runtime()

  function syncCount(items: DownloadTaskLite[]) {
    cache.value = items
    activeCount.value = items.filter((t) => ACTIVE.has(t.status)).length
  }

  function upsertTask(task: DownloadTaskLite) {
    if (task.status === 'deleted') {
      syncCount(cache.value.filter((t) => t.id !== task.id))
      return
    }
    const next = cache.value.slice()
    const idx = next.findIndex((t) => t.id === task.id)
    if (idx >= 0) next[idx] = { ...next[idx], ...task }
    else next.unshift(task)
    syncCount(next)
  }

  async function refresh() {
    try {
      const res = await $fetch<{ items: DownloadTaskLite[] }>('/api/downloads')
      const items = res.items || []
      syncCount(items)
      for (const h of rt.snapshotHandlers) h(items)
    } catch {
      /* ignore */
    }
  }

  function stopPoll() {
    if (rt.pollTimer) {
      clearInterval(rt.pollTimer)
      rt.pollTimer = null
    }
  }

  function startPoll() {
    if (rt.pollTimer) return
    void refresh()
    rt.pollTimer = setInterval(() => void refresh(), 3000)
  }

  function clearReconnect() {
    if (rt.reconnectTimer) {
      clearTimeout(rt.reconnectTimer)
      rt.reconnectTimer = null
    }
  }

  function markOk() {
    connected.value = true
    rt.errorSince = null
    stopPoll()
    clearReconnect()
  }

  function connect(force = false) {
    if (!import.meta.client) return

    // 已有可用连接则复用，禁止再 new EventSource
    if (
      !force &&
      rt.es &&
      (rt.es.readyState === EventSource.OPEN || rt.es.readyState === EventSource.CONNECTING)
    ) {
      return
    }

    clearReconnect()
    try {
      rt.es?.close()
    } catch {
      /* ignore */
    }
    rt.es = null

    try {
      const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
      const next = new EventSource(`${base}api/downloads/events`)
      rt.es = next

      next.addEventListener('snapshot', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data)
          const items = (data.items || []) as DownloadTaskLite[]
          syncCount(items)
          for (const h of rt.snapshotHandlers) h(items)
          markOk()
        } catch {
          /* ignore */
        }
      })

      next.addEventListener('task', (ev) => {
        try {
          const task = JSON.parse((ev as MessageEvent).data) as DownloadTaskLite
          upsertTask(task)
          for (const h of rt.taskHandlers) h(task)
          markOk()
        } catch {
          /* ignore */
        }
      })

      next.onopen = () => markOk()

      next.onerror = () => {
        // 过期实例的回调忽略
        if (rt.es !== next) return
        connected.value = false
        if (next.readyState === EventSource.CONNECTING) return
        if (rt.errorSince == null) rt.errorSince = Date.now()
        if (Date.now() - rt.errorSince >= POLL_AFTER_MS) startPoll()
        if (next.readyState === EventSource.CLOSED) {
          rt.es = null
          clearReconnect()
          rt.reconnectTimer = setTimeout(() => connect(true), RECONNECT_MS)
        }
      }
    } catch {
      startPoll()
      rt.reconnectTimer = setTimeout(() => connect(true), RECONNECT_MS)
    }
  }

  function stopWatching() {
    if (!import.meta.client) return
    const rt = runtime()
    rt.watching = false
    clearReconnect()
    stopPoll()
    try {
      rt.es?.close()
    } catch {
      /* ignore */
    }
    rt.es = null
    connected.value = false
  }

  function startWatching() {
    if (!import.meta.client) return
    if (!rt.watching) {
      rt.watching = true
      connect(false)
    } else {
      // 已在看：只确保连接活着，绝不新开第二条
      connect(false)
    }

    if (!rt.changedBound) {
      rt.changedBound = true
      window.addEventListener('miyin:downloads-changed', () => void refresh())
    }
    if (!rt.onlineBound) {
      rt.onlineBound = true
      window.addEventListener('online', () => connect(true))
    }
  }

  function onSnapshot(handler: SnapshotHandler) {
    rt.snapshotHandlers.add(handler)
    // 若已有缓存，立即推一帧，避免等下一次 snapshot
    if (cache.value.length) handler(cache.value)
    return () => rt.snapshotHandlers.delete(handler)
  }

  function onTask(handler: TaskHandler) {
    rt.taskHandlers.add(handler)
    return () => rt.taskHandlers.delete(handler)
  }

  function notifyChanged() {
    if (import.meta.client) {
      window.dispatchEvent(new Event('miyin:downloads-changed'))
    }
    void refresh()
  }

  return {
    activeCount,
    cache,
    connected,
    refresh,
    startWatching,
    stopWatching,
    notifyChanged,
    onSnapshot,
    onTask,
  }
}

/** 退出登录等场景：关闭全局 SSE/轮询，不依赖组件实例 */
export function stopDownloadWatching() {
  if (!import.meta.client) return
  const rt = runtime()
  rt.watching = false
  if (rt.pollTimer) {
    clearInterval(rt.pollTimer)
    rt.pollTimer = null
  }
  if (rt.reconnectTimer) {
    clearTimeout(rt.reconnectTimer)
    rt.reconnectTimer = null
  }
  try {
    rt.es?.close()
  } catch {
    /* ignore */
  }
  rt.es = null
  rt.errorSince = null
  try {
    const connected = useState('download-sse-connected', () => false)
    connected.value = false
  } catch {
    /* ignore */
  }
}
