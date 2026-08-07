export type ToastType = 'success' | 'error' | 'warning' | 'info'

export type ToastItem = {
  id: string
  type: ToastType
  message: string
  duration: number
  createdAt: number
}

const MAX_VISIBLE = 3
const DEDUPE_MS = 1800

const DURATIONS: Record<ToastType, number> = {
  success: 2500,
  info: 2800,
  warning: 3500,
  error: 4500,
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let lastDedupeKey = ''
let lastDedupeAt = 0

export function useToast() {
  const toasts = useState<ToastItem[]>('miyin-toasts', () => [])

  function dismiss(id: string) {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((x) => x.id !== id)
  }

  function clear() {
    for (const id of [...timers.keys()]) {
      const t = timers.get(id)
      if (t) clearTimeout(t)
    }
    timers.clear()
    toasts.value = []
  }

  function push(type: ToastType, message: string, opts?: { duration?: number }) {
    if (!import.meta.client) return ''
    const msg = String(message || '').trim()
    if (!msg) return ''

    const key = `${type}:${msg}`
    const now = Date.now()
    if (key === lastDedupeKey && now - lastDedupeAt < DEDUPE_MS) {
      return ''
    }
    lastDedupeKey = key
    lastDedupeAt = now

    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const duration = opts?.duration ?? DURATIONS[type]
    const item: ToastItem = { id, type, message: msg, duration, createdAt: now }

    while (toasts.value.length >= MAX_VISIBLE) {
      const oldest = toasts.value[0]
      if (oldest) dismiss(oldest.id)
      else break
    }
    toasts.value = [...toasts.value, item]

    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => {
          dismiss(id)
        }, duration),
      )
    }
    return id
  }

  return {
    toasts: readonly(toasts),
    push,
    success: (message: string, opts?: { duration?: number }) => push('success', message, opts),
    error: (message: string, opts?: { duration?: number }) => push('error', message, opts),
    warning: (message: string, opts?: { duration?: number }) => push('warning', message, opts),
    info: (message: string, opts?: { duration?: number }) => push('info', message, opts),
    dismiss,
    clear,
  }
}

/** 从 $fetch / ofetch 错误中提取可读文案 */
export function apiErrorMessage(err: unknown, fallback = '操作失败') {
  const e = err as any
  return (
    e?.data?.statusMessage ||
    e?.data?.message ||
    e?.statusMessage ||
    e?.message ||
    fallback
  )
}
