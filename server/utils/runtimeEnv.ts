import { randomBytes } from 'node:crypto'

/**
 * 运行时环境读取：优先 process.env（飞牛 cmd/main、Docker 常用 AUTH_TOKEN 等），
 * 再回退 Nuxt runtimeConfig（需 NUXT_* 才能在运行时覆盖）。
 *
 * 注意：nuxt.config 里写 process.env.XXX 只在「构建时」生效；生产必须以本文件为准。
 */

function runtimeConfigSafe(): Record<string, unknown> {
  try {
    return useRuntimeConfig() as Record<string, unknown>
  } catch {
    return {}
  }
}

function firstDefinedString(...candidates: Array<string | undefined | null>): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string') return c
  }
  return undefined
}

/** 访问口令（仅环境变量 / runtimeConfig，不含应用内覆盖） */
export function getAuthTokenFromEnv(): string {
  const fromEnv = firstDefinedString(process.env.AUTH_TOKEN, process.env.NUXT_AUTH_TOKEN)
  if (fromEnv !== undefined) return fromEnv
  return String(runtimeConfigSafe().authToken ?? '')
}

/**
 * @deprecated 请优先使用 authTokenService.getEffectiveAuthToken（含设置页覆盖）。
 * 保留为环境变量读取别名，避免旧调用在无库上下文出错。
 */
export function getAuthToken(): string {
  return getAuthTokenFromEnv()
}

/** 未配置 SESSION_SECRET 时的进程内随机密钥（重启后生成新值，旧会话失效需重新登录） */
let generatedSessionSecret: string | null = null

export function getSessionSecret(): string {
  const fromEnv = firstDefinedString(process.env.SESSION_SECRET, process.env.NUXT_SESSION_SECRET)
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  const fromCfg = String(runtimeConfigSafe().sessionSecret ?? '')
  if (fromCfg) return fromCfg
  // 安全兜底：绝不能回退到可预测的固定值，否则开启口令鉴权时可被伪造会话
  if (!generatedSessionSecret) {
    generatedSessionSecret = randomBytes(32).toString('hex')
  }
  return generatedSessionSecret
}

export function getDataDirEnv(): string {
  const fromEnv = firstDefinedString(process.env.DATA_DIR, process.env.NUXT_DATA_DIR)
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return String(runtimeConfigSafe().dataDir || './data')
}

export function getDownloadDirEnv(): string {
  const fromEnv = firstDefinedString(process.env.DOWNLOAD_DIR, process.env.NUXT_DOWNLOAD_DIR)
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return String(runtimeConfigSafe().downloadDir || './downloads')
}
