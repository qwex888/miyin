/**
 * 退出登录时重置客户端会话：销毁 KeepAlive 页面、断开 SSE、清飞牛 SDK/授权临时态。
 * 登录态内仍保留 keepalive，仅会话边界强制重建。
 */

const SESSION_STATE_KEYS = [
  'fnos-dir-auth-status',
  'fnos-dir-auth-loading',
  'fnos-dir-auth-sdk',
  'fnos-dir-auth-dismissed',
  'download-active-count',
  'download-badge-cache',
  'download-sse-connected',
] as const

export function usePageSession() {
  return useState('ui:page-session', () => 0)
}

export function bumpPageSession() {
  usePageSession().value += 1
}

export function resetClientSession() {
  if (import.meta.client) {
    try {
      stopDownloadWatching()
    } catch {
      /* ignore */
    }
    try {
      resetFnOsClient()
    } catch {
      /* ignore */
    }
    for (const key of SESSION_STATE_KEYS) {
      try {
        clearNuxtState(key)
      } catch {
        /* ignore */
      }
    }
  }

  bumpPageSession()
}
