import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDataDirEnv, getDownloadDirEnv } from './runtimeEnv'

function runtimeOrEnv(key: 'dataDir' | 'downloadDir', fallback: string) {
  try {
    if (key === 'dataDir') return getDataDirEnv() || fallback
    return getDownloadDirEnv() || fallback
  } catch {
    if (key === 'dataDir') return process.env.DATA_DIR || process.env.NUXT_DATA_DIR || fallback
    return process.env.DOWNLOAD_DIR || process.env.NUXT_DOWNLOAD_DIR || fallback
  }
}

export function getDataDir(override?: string) {
  const dir = resolve(override || runtimeOrEnv('dataDir', './data'))
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'sources'), { recursive: true })
  return dir
}

export function resolveDownloadDir(override?: string) {
  return resolve(override || runtimeOrEnv('downloadDir', './downloads'))
}

export function getDownloadDir(override?: string) {
  const dir = resolveDownloadDir(override)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getSourceCachePath(id: string, dataDir?: string) {
  return join(getDataDir(dataDir), 'sources', `${id}.js`)
}

export function getDbPath(dataDir?: string) {
  return join(getDataDir(dataDir), 'miyin.sqlite')
}
