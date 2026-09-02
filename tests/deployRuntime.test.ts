import { afterEach, describe, expect, it } from 'vitest'
import { getDeployMode } from '../server/utils/deployRuntime'

const KEYS = ['TRIM_API_TOKEN', 'TRIM_PKGETC', 'TRIM_APPNAME', 'MIYIN_RUNTIME'] as const

describe('getDeployMode', () => {
  const saved: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
      delete saved[k]
    }
  })

  function clearEnv() {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  }

  it('returns fnos when TRIM env is set', () => {
    clearEnv()
    process.env.TRIM_APPNAME = 'miyin'
    expect(getDeployMode()).toBe('fnos')
  })

  it('returns docker when MIYIN_RUNTIME=docker', () => {
    clearEnv()
    process.env.MIYIN_RUNTIME = 'docker'
    expect(getDeployMode()).toBe('docker')
  })

  it('prefers fnos over docker env', () => {
    clearEnv()
    process.env.TRIM_PKGETC = '/tmp/etc'
    process.env.MIYIN_RUNTIME = 'docker'
    expect(getDeployMode()).toBe('fnos')
  })

  it('returns other when neither fnos nor docker env', () => {
    clearEnv()
    // 本机测试环境通常无 /.dockerenv；若存在则本断言会变成 docker，属预期
    const mode = getDeployMode()
    expect(mode === 'other' || mode === 'docker').toBe(true)
  })
})
