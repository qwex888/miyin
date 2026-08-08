import { resolve } from 'node:path'
import { getSettings } from './settingsService'
import {
  getDownloadMode,
  isFnOsRuntime,
  pathCoveredByRoots,
  updateMiyinDownloadEnv,
} from '../utils/fnosEnv'
import { canCallFnOsOpenApi, getSharedAccessibleFolders } from '../utils/fnosOpenApi'

export type FnOsDirAuthStatus = {
  supported: boolean
  downloadDir: string
  downloadMode: 'default' | 'custom'
  paths: string[]
  authorized: boolean
  needsAuth: boolean
  reason?: string
}

function envAccessiblePaths(): string[] {
  const raw = String(process.env.TRIM_DATA_ACCESSIBLE_PATHS || '').trim()
  if (!raw) return []
  return raw.split(':').map((s) => s.trim()).filter(Boolean)
}

export async function getFnOsDirAuthStatus(): Promise<FnOsDirAuthStatus> {
  const settings = getSettings()
  const downloadDir = resolve(settings.downloadDir)
  const downloadMode = getDownloadMode()

  if (!isFnOsRuntime()) {
    return {
      supported: false,
      downloadDir,
      downloadMode,
      paths: [],
      authorized: true,
      needsAuth: false,
      reason: 'non-fnos',
    }
  }

  if (!canCallFnOsOpenApi()) {
    const fallback = envAccessiblePaths()
    const authorized = downloadMode === 'default' || pathCoveredByRoots(downloadDir, fallback)
    return {
      supported: true,
      downloadDir,
      downloadMode,
      paths: fallback,
      authorized,
      needsAuth: downloadMode === 'custom' && !authorized,
      reason: 'missing-api-token',
    }
  }

  try {
    const apiPaths = await getSharedAccessibleFolders()
    const merged = Array.from(new Set([...apiPaths, ...envAccessiblePaths()]))
    const authorized = downloadMode === 'default' || pathCoveredByRoots(downloadDir, merged)
    return {
      supported: true,
      downloadDir,
      downloadMode,
      paths: merged,
      authorized,
      needsAuth: downloadMode === 'custom' && !authorized,
    }
  } catch (e: any) {
    const fallback = envAccessiblePaths()
    const authorized = downloadMode === 'default' || pathCoveredByRoots(downloadDir, fallback)
    return {
      supported: true,
      downloadDir,
      downloadMode,
      paths: fallback,
      authorized,
      needsAuth: downloadMode === 'custom' && !authorized,
      reason: e?.statusMessage || e?.message || 'open-api-error',
    }
  }
}

export function persistCustomDownloadDir(dir: string) {
  const customDownloadDir = resolve(dir)
  if (!customDownloadDir.startsWith('/')) {
    throw createError({ statusCode: 400, statusMessage: '下载目录必须是绝对路径' })
  }
  const written = updateMiyinDownloadEnv({
    downloadMode: 'custom',
    customDownloadDir,
  })
  // 当前进程立即使用新目录（重启后由 cmd/main 再注入）
  process.env.DOWNLOAD_MODE = 'custom'
  process.env.CUSTOM_DOWNLOAD_DIR = customDownloadDir
  process.env.DOWNLOAD_DIR = customDownloadDir
  return written
}
