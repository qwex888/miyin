import type { AppUpdateCheckResult, MiyinLatestManifest } from '#shared/appUpdate'
import { isNewerVersion } from '#shared/appUpdate'

const MANIFEST_TIMEOUT_MS = 15_000

function manifestUrl(): string {
  const config = useRuntimeConfig()
  return String(
    config.public.updateManifestUrl ||
      'https://github.com/qwex888/miyin/releases/latest/download/latest.json',
  )
}

function currentVersion(): string {
  const config = useRuntimeConfig()
  return String(config.public.appVersion || '0.0.0')
}

function normalizeManifest(raw: unknown): MiyinLatestManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const version = String(o.version || '').trim()
  if (!version) return null
  const downloadsRaw = (o.downloads || {}) as Record<string, unknown>
  return {
    version,
    tag: String(o.tag || `v${version}`),
    releasedAt: String(o.releasedAt || ''),
    changelog: String(o.changelog || ''),
    downloads: {
      releasePage: String(
        downloadsRaw.releasePage ||
          `https://github.com/qwex888/miyin/releases/tag/v${version}`,
      ),
      fpk: downloadsRaw.fpk ? String(downloadsRaw.fpk) : undefined,
      dockerHub: downloadsRaw.dockerHub ? String(downloadsRaw.dockerHub) : undefined,
      ghcr: downloadsRaw.ghcr ? String(downloadsRaw.ghcr) : undefined,
    },
  }
}

export default defineEventHandler(async (): Promise<AppUpdateCheckResult> => {
  const current = currentVersion()
  const url = manifestUrl()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'miyin/update-check',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      return { current, hasUpdate: false, latest: null }
    }
    const raw = await res.json()
    const latest = normalizeManifest(raw)
    if (!latest) {
      return { current, hasUpdate: false, latest: null }
    }
    const hasUpdate = isNewerVersion(latest.version, current)
    return {
      current,
      hasUpdate,
      latest: hasUpdate ? latest : null,
    }
  } catch {
    return { current, hasUpdate: false, latest: null }
  } finally {
    clearTimeout(timer)
  }
})
