import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 是否运行在飞牛应用环境（具备开放 API token 或包配置目录） */
export function isFnOsRuntime() {
  return Boolean(process.env.TRIM_API_TOKEN || process.env.TRIM_PKGETC || process.env.TRIM_APPNAME)
}

export function getFnOsAppName() {
  return String(process.env.TRIM_APPNAME || 'miyin').trim() || 'miyin'
}

export function getDownloadMode(): 'default' | 'custom' {
  return process.env.DOWNLOAD_MODE === 'custom' ? 'custom' : 'default'
}

export function getMiyinEnvPath() {
  const etc = process.env.TRIM_PKGETC
  if (!etc) return null
  return join(etc, 'miyin.env')
}

function shellEscape(value: string) {
  return value.replace(/'/g, `'\\''`)
}

function readEnvMap(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(file)) return out
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)='((?:\\'|[^'])*)'$/)
    const quotedKey = m?.[1]
    const quotedVal = m?.[2]
    if (quotedKey !== undefined && quotedVal !== undefined) {
      out[quotedKey] = quotedVal.replace(/\\'/g, "'")
      continue
    }
    const m2 = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    const key = m2?.[1]
    let value = m2?.[2]
    if (key === undefined || value === undefined) continue
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * 更新 miyin.env 中的下载目录相关字段，保留 AUTH_TOKEN / SESSION_SECRET。
 */
export function updateMiyinDownloadEnv(input: {
  downloadMode: 'default' | 'custom'
  customDownloadDir: string
}) {
  const file = getMiyinEnvPath()
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: '非飞牛环境或缺少 TRIM_PKGETC，无法写入配置' })
  }
  if (input.downloadMode === 'custom') {
    const dir = resolve(input.customDownloadDir)
    if (!dir.startsWith('/')) {
      throw createError({ statusCode: 400, statusMessage: '自定义下载目录必须是绝对路径' })
    }
  }

  mkdirSync(dirname(file), { recursive: true })
  const prev = readEnvMap(file)
  const token = prev.AUTH_TOKEN ?? process.env.AUTH_TOKEN ?? ''
  const secret = prev.SESSION_SECRET ?? process.env.SESSION_SECRET ?? ''
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: '缺少 SESSION_SECRET，请重新运行安装/配置向导' })
  }

  const mode = input.downloadMode === 'custom' ? 'custom' : 'default'
  const customDir = mode === 'custom' ? resolve(input.customDownloadDir) : ''

  writeMiyinEnvFile(file, {
    token,
    secret,
    downloadMode: mode,
    customDownloadDir: customDir,
  })
  return { file, downloadMode: mode, customDownloadDir: customDir }
}

/** 更新 miyin.env 中的 AUTH_TOKEN，保留下载目录与 SESSION_SECRET */
export function updateMiyinAuthToken(token: string) {
  const file = getMiyinEnvPath()
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: '非飞牛环境或缺少 TRIM_PKGETC，无法写入配置' })
  }
  mkdirSync(dirname(file), { recursive: true })
  const prev = readEnvMap(file)
  const secret = prev.SESSION_SECRET ?? process.env.SESSION_SECRET ?? ''
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: '缺少 SESSION_SECRET，请重新运行安装/配置向导' })
  }
  const mode = (prev.DOWNLOAD_MODE === 'custom' ? 'custom' : 'default') as 'default' | 'custom'
  const customDir = mode === 'custom' ? String(prev.CUSTOM_DOWNLOAD_DIR || '') : ''
  writeMiyinEnvFile(file, {
    token: String(token ?? ''),
    secret,
    downloadMode: mode,
    customDownloadDir: customDir,
  })
  return { file }
}

function writeMiyinEnvFile(
  file: string,
  input: {
    token: string
    secret: string
    downloadMode: 'default' | 'custom'
    customDownloadDir: string
  },
) {
  const body = `# 觅音运行配置（由安装/配置向导或应用内设置写入，请勿手改敏感字段到日志）
# AUTH_TOKEN 为空表示开放模式（免登录）
AUTH_TOKEN='${shellEscape(input.token)}'
SESSION_SECRET='${shellEscape(input.secret)}'
DOWNLOAD_MODE='${shellEscape(input.downloadMode)}'
CUSTOM_DOWNLOAD_DIR='${shellEscape(input.customDownloadDir)}'
`
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
}

/** downloadDir 是否被 paths 中某一项覆盖（相等或为其子路径） */
export function pathCoveredByRoots(downloadDir: string, roots: string[]) {
  const normalize = (p: string) => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const target = normalize(downloadDir)
  for (const root of roots) {
    if (!root) continue
    const r = normalize(root)
    if (target === r || target.startsWith(`${r}/`)) return true
  }
  return false
}
