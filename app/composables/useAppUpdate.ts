import type { AppDeployMode, AppUpdateCheckResult, MiyinLatestManifest } from '#shared/appUpdate'

const DISMISS_KEY = 'miyin-update-dismissed'
const LAST_CHECK_KEY = 'miyin-update-last-check'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function useAppUpdate() {
  const config = useRuntimeConfig()
  const currentVersion = computed(() => String(config.public.appVersion || '0.0.0'))
  const hasUpdate = useState<boolean>('app-update:has', () => false)
  const latest = useState<MiyinLatestManifest | null>('app-update:latest', () => null)
  const deployMode = useState<AppDeployMode>('app-update:deploy', () => 'other')
  const checking = useState<boolean>('app-update:checking', () => false)
  const dismissedVersion = useState<string | null>('app-update:dismissed', () => null)
  const dialogOpen = useState<boolean>('app-update:dialog', () => false)
  const pendingOpenChangelog = useState<boolean>('app-update:pending-open', () => false)

  const showBadge = computed(
    () => hasUpdate.value && latest.value?.version !== dismissedVersion.value,
  )

  function loadDismissed() {
    if (!import.meta.client) return
    try {
      dismissedVersion.value = localStorage.getItem(DISMISS_KEY)
    } catch {
      /* ignore */
    }
  }

  function shouldSkipCheck(force: boolean): boolean {
    if (force || !import.meta.client) return false
    try {
      const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0)
      return last > 0 && Date.now() - last < CHECK_INTERVAL_MS
    } catch {
      return false
    }
  }

  function markChecked() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
  }

  async function checkForUpdate(force = false): Promise<AppUpdateCheckResult | null> {
    if (checking.value) return null
    if (shouldSkipCheck(force)) return null
    checking.value = true
    try {
      const res = await $fetch<AppUpdateCheckResult>('/api/app/update-check')
      hasUpdate.value = res.hasUpdate
      latest.value = res.latest
      deployMode.value = res.deployMode || 'other'
      markChecked()
      return res
    } catch {
      return null
    } finally {
      checking.value = false
    }
  }

  function requestOpenOnSettings() {
    pendingOpenChangelog.value = true
  }

  function consumePendingOpen(): boolean {
    if (!pendingOpenChangelog.value) return false
    pendingOpenChangelog.value = false
    return true
  }

  function openChangelog() {
    if (hasUpdate.value && latest.value) dialogOpen.value = true
  }

  function dismissUpdate() {
    if (latest.value?.version) {
      dismissedVersion.value = latest.value.version
      if (import.meta.client) {
        try {
          localStorage.setItem(DISMISS_KEY, latest.value.version)
        } catch {
          /* ignore */
        }
      }
    }
    dialogOpen.value = false
  }

  function closeDialog() {
    dialogOpen.value = false
  }

  if (import.meta.client) {
    loadDismissed()
  }

  return {
    currentVersion,
    hasUpdate,
    latest,
    deployMode,
    checking,
    showBadge,
    dialogOpen,
    checkForUpdate,
    openChangelog,
    requestOpenOnSettings,
    consumePendingOpen,
    dismissUpdate,
    closeDialog,
  }
}
