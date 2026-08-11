import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { getAuthToken, getSessionSecret, getDownloadDirEnv } from '../server/utils/runtimeEnv'

describe('runtimeEnv', () => {
  const prev = { ...process.env }

  beforeEach(() => {
    delete process.env.AUTH_TOKEN
    delete process.env.NUXT_AUTH_TOKEN
    delete process.env.SESSION_SECRET
    delete process.env.NUXT_SESSION_SECRET
    delete process.env.DOWNLOAD_DIR
    delete process.env.NUXT_DOWNLOAD_DIR
  })

  afterEach(() => {
    process.env = { ...prev }
  })

  it('prefers AUTH_TOKEN over empty for open mode detection', () => {
    process.env.AUTH_TOKEN = ''
    expect(getAuthToken()).toBe('')
  })

  it('reads AUTH_TOKEN when set by fnOS/Docker', () => {
    process.env.AUTH_TOKEN = 'secret-from-wizard'
    expect(getAuthToken()).toBe('secret-from-wizard')
  })

  it('reads DOWNLOAD_DIR from process env', () => {
    process.env.DOWNLOAD_DIR = '/vol1/music'
    expect(getDownloadDirEnv()).toBe('/vol1/music')
  })

  it('falls back session secret when unset', () => {
    expect(getSessionSecret().length).toBeGreaterThan(0)
  })
})
