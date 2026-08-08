import { TrimApp } from '@trimjs/web-app'
import type { AppAuthResult } from '@trimjs/web-app'

export type FnOsDirAuthStatus = {
  supported: boolean
  downloadDir: string
  downloadMode: 'default' | 'custom'
  paths: string[]
  authorized: boolean
  needsAuth: boolean
  reason?: string
}

const DISMISS_KEY = 'miyin:fnos-dir-auth-dismiss'
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000
const AUTH_MSG_TYPE = 'miyin:fnos-auth-result'
const AUTH_STATE_KEY = 'miyin:fnos-auth-state'

let sdkSingleton: TrimApp | null = null

async function getSdk() {
  if (!import.meta.client) return null
  if (!sdkSingleton) {
    sdkSingleton = new TrimApp({ debug: false })
  }
  await sdkSingleton.ready()
  return sdkSingleton
}

function createAuthState() {
  const state = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  try {
    sessionStorage.setItem(AUTH_STATE_KEY, state)
  } catch {
    /* ignore */
  }
  return state
}

function readAuthState() {
  try {
    return sessionStorage.getItem(AUTH_STATE_KEY) || ''
  } catch {
    return ''
  }
}

function clearAuthState() {
  try {
    sessionStorage.removeItem(AUTH_STATE_KEY)
  } catch {
    /* ignore */
  }
}

function callbackRedirectUri() {
  const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
  return `${window.location.origin}${base}fnos-auth-callback`
}

function readDismissedFlag() {
  if (!import.meta.client) return false
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_MS
  } catch {
    return false
  }
}

export function useFnOsDirAuth() {
  const status = useState<FnOsDirAuthStatus | null>('fnos-dir-auth-status', () => null)
  const loading = useState('fnos-dir-auth-loading', () => false)
  const sdkReady = useState('fnos-dir-auth-sdk', () => false)
  const dismissed = useState('fnos-dir-auth-dismissed', () => readDismissedFlag())
  const toast = useToast()

  const showHomeBanner = computed(() => {
    if (!status.value?.needsAuth) return false
    if (dismissed.value) return false
    return true
  })

  function dismissBanner() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
    dismissed.value = true
  }

  function clearDismiss() {
    try {
      localStorage.removeItem(DISMISS_KEY)
    } catch {
      /* ignore */
    }
    dismissed.value = false
  }

  async function refresh() {
    if (import.meta.client) dismissed.value = readDismissedFlag()
    loading.value = true
    try {
      status.value = await $fetch<FnOsDirAuthStatus>('/api/fnos/dir-auth')
      if (status.value.authorized) clearDismiss()
      return status.value
    } catch {
      status.value = {
        supported: false,
        downloadDir: '',
        downloadMode: 'default',
        paths: [],
        authorized: true,
        needsAuth: false,
        reason: 'fetch-failed',
      }
      return status.value
    } finally {
      loading.value = false
    }
  }

  async function ensureSdk() {
    try {
      const sdk = await getSdk()
      sdkReady.value = Boolean(sdk)
      return sdk
    } catch {
      sdkReady.value = false
      return null
    }
  }

  async function persistDownloadDir(downloadDir: string) {
    const res = await $fetch<{
      ok: boolean
      downloadDir: string
      restartRequired: boolean
      auth: FnOsDirAuthStatus
    }>('/api/fnos/download-dir', {
      method: 'POST',
      body: { downloadDir },
    })
    status.value = res.auth
    return res
  }

  async function pickAndAuthorize() {
    const sdk = await ensureSdk()
    if (!sdk) {
      toast.error('飞牛 JS SDK 不可用，请到系统应用设置中添加目录授权')
      return null
    }

    if (sdk.isStandaloneWeb) {
      const state = createAuthState()
      await sdk.openAppAuth(
        'pickSharedFile',
        {
          appName: 'miyin',
          sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites', 'team'],
          redirectUri: callbackRedirectUri(),
          state,
        },
        { target: '_blank', features: 'width=750,height=630' },
      )
      toast.info('请在授权窗口完成后返回本页，并点击「刷新授权状态」')
      return null
    }

    const result = await sdk.pickSharedFile({
      title: '选择并授权下载目录',
      okText: '确认授权',
      sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites', 'team'],
    })
    if (!result || result.code !== 0) {
      toast.error(result?.msg || '授权失败（需管理员操作）')
      return null
    }
    const paths = Array.isArray(result.data) ? result.data : []
    const dir = paths[0]
    if (!dir) {
      toast.warning('未选择目录')
      return null
    }
    const persisted = await persistDownloadDir(dir)
    toast.success('目录已授权并写入配置，请重启应用使权限完全生效')
    return persisted
  }

  async function authorizeCurrentPath(path?: string) {
    const target = (path || status.value?.downloadDir || '').trim()
    if (!target.startsWith('/')) {
      toast.error('当前下载目录不是绝对路径，请先填写或选择目录')
      return null
    }

    const sdk = await ensureSdk()
    if (!sdk) {
      toast.error('飞牛 JS SDK 不可用，请到系统应用设置中添加目录授权')
      return null
    }

    if (sdk.isStandaloneWeb) {
      const state = createAuthState()
      await sdk.openAppAuth(
        'authorizeSharedFile',
        {
          appName: 'miyin',
          path: target,
          redirectUri: callbackRedirectUri(),
          state,
        },
        { target: '_blank', features: 'width=750,height=630' },
      )
      toast.info('请在授权窗口完成后返回本页，并点击「刷新授权状态」')
      return null
    }

    const result = await sdk.authorizeSharedFile(target)
    if (!result || result.code !== 0) {
      toast.error(result?.msg || '授权失败（需管理员操作）')
      return null
    }
    // SDK 可能返回 boolean 或路径列表
    const ok = result.data === true || (Array.isArray(result.data) && result.data.length > 0)
    if (!ok && result.data !== true) {
      // code===0 仍视为成功
    }
    await persistDownloadDir(target)
    await refresh()
    toast.success('当前路径已授权，请重启应用使权限完全生效')
    return status.value
  }

  async function openSystemAppSetting() {
    const sdk = await ensureSdk()
    if (!sdk) {
      toast.error('无法打开系统应用设置')
      return
    }
    try {
      await sdk.openAppSetting()
    } catch {
      toast.error('打开系统应用设置失败')
    }
  }

  function bindAuthMessage(onDone?: () => void) {
    if (!import.meta.client) return () => {}
    const handler = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== AUTH_MSG_TYPE) return
      const result = event.data.result as AppAuthResult | undefined
      const expected = readAuthState()
      if (expected && result?.state && result.state !== expected) return
      clearAuthState()
      if (result?.status === 'error') {
        toast.error(result.error === 'access_denied' ? '仅管理员可进行此操作' : '授权失败')
        return
      }
      if (result?.status === 'cancel') {
        toast.info('已取消授权')
        return
      }
      const paths = result?.path || []
      if (paths[0]) {
        try {
          await persistDownloadDir(paths[0])
        } catch (e: unknown) {
          toast.error(apiErrorMessage(e, '写入下载目录失败'))
        }
      }
      await refresh()
      toast.success('授权完成，请重启应用使权限完全生效')
      onDone?.()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }

  return {
    status,
    loading,
    sdkReady,
    showHomeBanner,
    refresh,
    ensureSdk,
    dismissBanner,
    pickAndAuthorize,
    authorizeCurrentPath,
    openSystemAppSetting,
    persistDownloadDir,
    bindAuthMessage,
    AUTH_MSG_TYPE,
  }
}

export function parseFnOsAuthCallback() {
  if (!import.meta.client) return null
  const sdk = new TrimApp()
  return sdk.parseAppAuthCallback(window.location.href)
}
