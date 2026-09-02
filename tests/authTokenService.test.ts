declare global {
  var createError: (input: {
    statusCode?: number
    statusMessage?: string
    message?: string
    data?: unknown
  }) => Error
}

if (!globalThis.createError) {
  globalThis.createError = (input) => {
    const err = new Error(input.message || input.statusMessage || 'Error') as Error & {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }
    err.statusCode = input.statusCode
    err.statusMessage = input.statusMessage
    err.data = input.data
    return err
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  changeAuthToken,
  getAuthTokenOverride,
  getEffectiveAuthToken,
  getAuthTokenStatus,
} from '../server/services/authTokenService'
import { getAuthTokenFromEnv } from '../server/utils/runtimeEnv'

describe('authTokenService priority (settings override > env)', () => {
  let tmpDir: string
  let prevDataDir: string | undefined
  let prevAuth: string | undefined
  let prevNuxtAuth: string | undefined
  let prevPkgEtc: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevAuth = process.env.AUTH_TOKEN
    prevNuxtAuth = process.env.NUXT_AUTH_TOKEN
    prevPkgEtc = process.env.TRIM_PKGETC
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-auth-token-'))
    process.env.DATA_DIR = tmpDir
    delete process.env.TRIM_PKGETC
    getDb()
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevAuth === undefined) delete process.env.AUTH_TOKEN
    else process.env.AUTH_TOKEN = prevAuth
    if (prevNuxtAuth === undefined) delete process.env.NUXT_AUTH_TOKEN
    else process.env.NUXT_AUTH_TOKEN = prevNuxtAuth
    if (prevPkgEtc === undefined) delete process.env.TRIM_PKGETC
    else process.env.TRIM_PKGETC = prevPkgEtc
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('uses env token before any settings override (Docker -e / FPK wizard)', () => {
    process.env.AUTH_TOKEN = 'from-wizard'
    expect(getAuthTokenOverride()).toBeUndefined()
    expect(getEffectiveAuthToken()).toBe('from-wizard')
    expect(getAuthTokenFromEnv()).toBe('from-wizard')
    expect(getAuthTokenStatus().source).toBe('env')
  })

  it('settings override wins over Docker/FPK env after change', () => {
    process.env.AUTH_TOKEN = 'from-docker'
    const res = changeAuthToken({ currentToken: 'from-docker', newToken: 'from-settings' })
    expect(res.ok).toBe(true)
    expect(getEffectiveAuthToken()).toBe('from-settings')
    expect(getAuthTokenFromEnv()).toBe('from-settings') // process.env also updated for immediate effect
    expect(getAuthTokenStatus().source).toBe('settings')
    expect(getAuthTokenStatus().hasOverride).toBe(true)
  })

  it('allows empty new token (open mode) and still overrides env', () => {
    process.env.AUTH_TOKEN = 'locked'
    changeAuthToken({ currentToken: 'locked', newToken: '' })
    expect(getEffectiveAuthToken()).toBe('')
    expect(getAuthTokenStatus().authRequired).toBe(false)
    // 即使 env 曾被改回，override 仍优先
    process.env.AUTH_TOKEN = 'locked-again'
    expect(getEffectiveAuthToken()).toBe('')
  })

  it('rejects wrong current token', () => {
    process.env.AUTH_TOKEN = 'secret'
    expect(() => changeAuthToken({ currentToken: 'wrong', newToken: 'x' })).toThrow(/当前口令不正确/)
  })

  it('syncs FPK miyin.env when TRIM_PKGETC is set (no restart needed for process.env)', () => {
    const etc = join(tmpDir, 'etc')
    mkdirSync(etc, { recursive: true })
    writeFileSync(
      join(etc, 'miyin.env'),
      `AUTH_TOKEN='old'\nSESSION_SECRET='sec'\nDOWNLOAD_MODE='default'\nCUSTOM_DOWNLOAD_DIR=''\n`,
      'utf8',
    )
    process.env.TRIM_PKGETC = etc
    process.env.AUTH_TOKEN = 'old'
    const res = changeAuthToken({ currentToken: 'old', newToken: 'new-fpk' })
    expect(res.fnosSynced).toBe(true)
    expect(res.restartRequired).toBe(false)
    expect(getEffectiveAuthToken()).toBe('new-fpk')
    const text = readFileSync(join(etc, 'miyin.env'), 'utf8')
    expect(text).toContain("AUTH_TOKEN='new-fpk'")
    expect(text).toContain("SESSION_SECRET='sec'")
  })
})
