import type { AppAuthResult, TrimApp } from '@trimjs/web-app'

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
const SDK_READY_TIMEOUT_MS = 15_000
const SDK_AUTH_TIMEOUT_MS = 120_000
const SDK_OPEN_AUTH_TIMEOUT_MS = 20_000

let sdkSingleton: TrimApp | null = null

/** @trimjs/web-app 在模块求值时读 window，禁止 SSR 静态导入 */
async function loadTrimApp() {
  const mod = await import('@trimjs/web-app')
  return mod.TrimApp
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}超时（${Math.round(ms / 1000)}s），请重试或到系统应用设置中操作`))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

async function getSdk() {
  if (!import.meta.client) return null
  if (!sdkSingleton) {
    const TrimAppCtor = await loadTrimApp()
    sdkSingleton = new TrimAppCtor({ debug: false })
  }
  await withTimeout(Promise.resolve(sdkSingleton.ready()), SDK_READY_TIMEOUT_MS, '飞牛 SDK 初始化')
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

/** 退出登录：释放 SDK 单例与授权临时态 */
export function resetFnOsClient() {
  clearAuthState()
  if (sdkSingleton) {
    try {
      const anySdk = sdkSingleton as TrimApp & { destroy?: () => void; dispose?: () => void }
      anySdk.destroy?.()
      anySdk.dispose?.()
    } catch {
      /* ignore */
    }
    sdkSingleton = null
  }
  try {
    const loading = useState('fnos-dir-auth-loading', () => false)
    const sdkReady = useState('fnos-dir-auth-sdk', () => false)
    const status = useState<FnOsDirAuthStatus | null>('fnos-dir-auth-status', () => null)
    loading.value = false
    sdkReady.value = false
    status.value = null
  } catch {
    /* ignore */
  }
}

function notifyAuthReason(toast: ReturnType<typeof useToast>, reason?: string) {
  if (!reason || reason === 'non-fnos') return
  if (reason === 'missing-api-token') {
    toast.warning('缺少 TRIM_API_TOKEN，无法调用飞牛开放 API 查询授权')
    return
  }
  if (reason === 'fetch-failed') {
    toast.error('获取飞牛授权状态失败')
    return
  }
  toast.error(`飞牛开放 API：${reason}`)
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

  async function refresh(opts?: { notifyError?: boolean }) {
    if (import.meta.client) dismissed.value = readDismissedFlag()
    loading.value = true
    try {
      status.value = await $fetch<FnOsDirAuthStatus>('/api/fnos/dir-auth')
      if (status.value.authorized) clearDismiss()
      if (opts?.notifyError) notifyAuthReason(toast, status.value.reason)
      return status.value
    } catch (e: unknown) {
      status.value = {
        supported: false,
        downloadDir: '',
        downloadMode: 'default',
        paths: [],
        authorized: true,
        needsAuth: false,
        reason: 'fetch-failed',
      }
      if (opts?.notifyError) toast.error(apiErrorMessage(e, '获取飞牛授权状态失败'))
      return status.value
    } finally {
      loading.value = false
    }
  }

  async function ensureSdk(opts?: { notifyError?: boolean }) {
    try {
      const sdk = await getSdk()
      sdkReady.value = Boolean(sdk)
      return sdk
    } catch (e: unknown) {
      sdkReady.value = false
      if (opts?.notifyError) toast.error(apiErrorMessage(e, '飞牛 JS SDK 初始化失败'))
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
    if (res.auth?.reason) notifyAuthReason(toast, res.auth.reason)
    return res
  }

  async function pickAndAuthorize() {
    const sdk = await ensureSdk({ notifyError: true })
    if (!sdk) {
      return null
    }

    try {
      if (sdk.isStandaloneWeb) {
        const state = createAuthState()
        await withTimeout(
          Promise.resolve(
            sdk.openAppAuth(
              'pickSharedFile',
              {
                appName: 'miyin',
                sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites', 'team'],
                redirectUri: callbackRedirectUri(),
                state,
              },
              { target: '_blank', features: 'width=750,height=630' },
            ),
          ),
          SDK_OPEN_AUTH_TIMEOUT_MS,
          '打开飞牛授权窗口',
        )
        toast.info('请在授权窗口完成后返回本页，并点击「刷新授权状态」')
        return null
      }

      const result = await withTimeout(
        Promise.resolve(
          sdk.pickSharedFile({
            title: '选择并授权下载目录',
            okText: '确认授权',
            sidebarGroup: ['myFiles', 'otherShare', 'external', 'remote', 'favorites', 'team'],
          }),
        ),
        SDK_AUTH_TIMEOUT_MS,
        '选择并授权目录',
      )
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
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, '选择授权失败'))
      return null
    }
  }

  async function authorizeCurrentPath(path?: string) {
    const target = (path || status.value?.downloadDir || '').trim()
    if (!target.startsWith('/')) {
      toast.error('当前下载目录不是绝对路径，请先填写或选择目录')
      return null
    }

    const sdk = await ensureSdk({ notifyError: true })
    if (!sdk) {
      return null
    }

    try {
      if (sdk.isStandaloneWeb) {
        const state = createAuthState()
        await withTimeout(
          Promise.resolve(
            sdk.openAppAuth(
              'authorizeSharedFile',
              {
                appName: 'miyin',
                path: target,
                redirectUri: callbackRedirectUri(),
                state,
              },
              { target: '_blank', features: 'width=750,height=630' },
            ),
          ),
          SDK_OPEN_AUTH_TIMEOUT_MS,
          '打开飞牛授权窗口',
        )
        toast.info('请在授权窗口完成后返回本页，并点击「刷新授权状态」')
        return null
      }

      const result = await withTimeout(
        Promise.resolve(sdk.authorizeSharedFile(target)),
        SDK_AUTH_TIMEOUT_MS,
        '授权当前路径',
      )
      if (!result || result.code !== 0) {
        toast.error(result?.msg || '授权失败（需管理员操作）')
        return null
      }
      await persistDownloadDir(target)
      await refresh({ notifyError: true })
      toast.success('当前路径已授权，请重启应用使权限完全生效')
      return status.value
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, '授权失败'))
      return null
    }
  }

  async function openSystemAppSetting() {
    const sdk = await ensureSdk({ notifyError: true })
    if (!sdk) {
      return
    }
    try {
      await withTimeout(Promise.resolve(sdk.openAppSetting()), SDK_OPEN_AUTH_TIMEOUT_MS, '打开系统应用设置')
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, '打开系统应用设置失败'))
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
      await refresh({ notifyError: true })
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

export async function parseFnOsAuthCallback() {
  if (!import.meta.client) return null
  const TrimAppCtor = await loadTrimApp()
  const sdk = new TrimAppCtor()
  return sdk.parseAppAuthCallback(window.location.href)
}
