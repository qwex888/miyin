type DownloadTaskLite = { id: string; status: string }

const ACTIVE = new Set(['queued', 'running'])

/**
 * 全局下载进行中数量（供顶栏角标）。
 * 优先 SSE，失败则轮询。
 */
export function useDownloadBadge() {
  const activeCount = useState('download-active-count', () => 0)
  const cache = useState<DownloadTaskLite[]>('download-badge-cache', () => [])

  function syncCount(items: DownloadTaskLite[]) {
    cache.value = items
    activeCount.value = items.filter((t) => ACTIVE.has(t.status)).length
  }

  function upsertTask(task: DownloadTaskLite) {
    const next = cache.value.slice()
    const idx = next.findIndex((t) => t.id === task.id)
    if (idx >= 0) next[idx] = task
    else next.unshift(task)
    syncCount(next)
  }

  async function refresh() {
    try {
      const res = await $fetch<{ items: DownloadTaskLite[] }>('/api/downloads')
      syncCount(res.items || [])
    } catch {
      /* 未登录或接口失败时忽略 */
    }
  }

  function startWatching() {
    if (!import.meta.client) return
    const started = useState('download-badge-watching', () => false)
    if (started.value) return
    started.value = true

    void refresh()

    let timer: ReturnType<typeof setInterval> | null = null
    let es: EventSource | null = null

    const startPoll = () => {
      if (timer) return
      timer = setInterval(() => void refresh(), 3000)
    }

    try {
      const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
      es = new EventSource(`${base}api/downloads/events`)
      es.addEventListener('snapshot', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data)
          syncCount(data.items || [])
        } catch {
          void refresh()
        }
      })
      es.addEventListener('task', (ev) => {
        try {
          upsertTask(JSON.parse((ev as MessageEvent).data) as DownloadTaskLite)
        } catch {
          void refresh()
        }
      })
      es.onerror = () => {
        es?.close()
        es = null
        startPoll()
      }
    } catch {
      startPoll()
    }

    window.addEventListener('miyin:downloads-changed', () => void refresh())
  }

  /** 入队成功后立刻刷新角标（SSE 可能略延迟） */
  function notifyChanged() {
    if (import.meta.client) {
      window.dispatchEvent(new Event('miyin:downloads-changed'))
    }
    void refresh()
  }

  return { activeCount, refresh, startWatching, notifyChanged }
}
