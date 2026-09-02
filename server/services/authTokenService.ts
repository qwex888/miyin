import { getDb } from '../utils/db'
import { isFnOsRuntime, getMiyinEnvPath, updateMiyinAuthToken } from '../utils/fnosEnv'
import { getAuthTokenFromEnv } from '../utils/runtimeEnv'
import { safeEqualString } from '../utils/crypto'
import { isAuthRequired } from '../utils/authMode'

const OVERRIDE_KEY = 'auth_token_override'

type OverridePayload = { token: string }

/**
 * 是否存在应用内口令覆盖（含空字符串=刻意开放模式）。
 * 无记录时返回 undefined，表示仍走环境变量。
 */
export function getAuthTokenOverride(): string | undefined {
  try {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(OVERRIDE_KEY) as { value: string } | undefined
    if (!row?.value) return undefined
    const parsed = JSON.parse(row.value) as OverridePayload
    if (parsed && typeof parsed.token === 'string') return parsed.token
    return undefined
  } catch {
    return undefined
  }
}

/** 生效口令：应用内覆盖 > 环境变量（Docker -e / FPK miyin.env） */
export function getEffectiveAuthToken(): string {
  const override = getAuthTokenOverride()
  if (override !== undefined) return override
  return getAuthTokenFromEnv()
}

export function getAuthTokenStatus() {
  const override = getAuthTokenOverride()
  const envToken = getAuthTokenFromEnv()
  const effective = override !== undefined ? override : envToken
  return {
    authRequired: isAuthRequired(effective),
    hasOverride: override !== undefined,
    source: (override !== undefined ? 'settings' : 'env') as 'settings' | 'env',
    runtime: isFnOsRuntime() ? 'fnos' : 'standard',
  }
}

function applyProcessEnvToken(token: string) {
  process.env.AUTH_TOKEN = token
  process.env.NUXT_AUTH_TOKEN = token
}

function persistOverride(token: string) {
  const value = JSON.stringify({ token } satisfies OverridePayload)
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(OVERRIDE_KEY, value)
}

/**
 * 修改访问口令：校验当前口令 → SQLite 覆盖 → 即时更新 process.env →
 * FPK 同步写 miyin.env（无需重启）。
 */
export function changeAuthToken(input: { currentToken: string; newToken: string }) {
  const currentExpected = getEffectiveAuthToken()
  const currentInput = String(input.currentToken ?? '')
  const next = String(input.newToken ?? '')

  if (!safeEqualString(currentInput, currentExpected)) {
    throw createError({ statusCode: 401, statusMessage: '当前口令不正确' })
  }

  if (safeEqualString(currentExpected, next) && getAuthTokenOverride() !== undefined) {
    return {
      ok: true,
      unchanged: true,
      ...getAuthTokenStatus(),
      restartRequired: false,
      message: '口令未变化',
    }
  }

  persistOverride(next)
  applyProcessEnvToken(next)

  let fnosSynced = false
  if (getMiyinEnvPath()) {
    try {
      updateMiyinAuthToken(next)
      fnosSynced = true
    } catch (err: unknown) {
      // SQLite + 进程内已生效；env 同步失败不回滚，但告知调用方
      const msg = (err as { statusMessage?: string; message?: string })?.statusMessage
        || (err as Error)?.message
        || String(err)
      return {
        ok: true,
        unchanged: false,
        ...getAuthTokenStatus(),
        restartRequired: false,
        fnosSynced: false,
        warning: `口令已生效，但写入飞牛 miyin.env 失败：${msg}`,
        message: isAuthRequired(next) ? '口令已更新并立即生效' : '已关闭口令鉴权（开放模式），立即生效',
      }
    }
  }

  return {
    ok: true,
    unchanged: false,
    ...getAuthTokenStatus(),
    restartRequired: false,
    fnosSynced,
    message: isAuthRequired(next)
      ? '口令已更新并立即生效'
      : '已关闭口令鉴权（开放模式），立即生效',
  }
}
