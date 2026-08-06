import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

function runtimeOrEnv(key: 'dataDir' | 'downloadDir', fallback: string) {
  try {
    const config = useRuntimeConfig()
    if (key === 'dataDir') return String(config.dataDir || fallback)
    return String(config.downloadDir || fallback)
  } catch {
    if (key === 'dataDir') return process.env.DATA_DIR || fallback
    return process.env.DOWNLOAD_DIR || fallback
  }
}

export function getDataDir(override?: string) {
  const dir = resolve(override || runtimeOrEnv('dataDir', './data'))
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'sources'), { recursive: true })
  return dir
}

export function getDownloadDir(override?: string) {
  const dir = resolve(override || runtimeOrEnv('downloadDir', './downloads'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getSourceCachePath(id: string, dataDir?: string) {
  return join(getDataDir(dataDir), 'sources', `${id}.js`)
}

export function getDbPath(dataDir?: string) {
  return join(getDataDir(dataDir), 'miyin.sqlite')
}
