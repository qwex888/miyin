import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runSandboxedSync,
  resetSourceRuntimeState,
  loadLxSource,
  parseScriptHeader,
  isBenignSourceNetworkError,
  isBenignSourceScriptError,
  acquireSourceRejectionGuard,
  settleSourceNetworkErrors,
} from '../server/services/sourceRuntime'

describe('source sandbox', () => {
  beforeEach(() => resetSourceRuntimeState())

  it('kills sync infinite loop via vm timeout', () => {
    expect(() => runSandboxedSync('while(true){}', 50)).toThrow()
  })

  it('rejects blocked require', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-src-'))
    const file = join(dir, 'bad.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      require('fs')
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
      `,
      'utf8',
    )
    await expect(loadLxSource(file, { bypassCache: true })).rejects.toThrow(/禁止 require/)
  })

  it('times out hanging getMusicUrl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-src-'))
    const file = join(dir, 'hang.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, () => new Promise(() => {}))
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
      `,
      'utf8',
    )
    const handle = await loadLxSource(file, { bypassCache: true })
    await expect(handle.getMusicUrl('wy', { songmid: '1' }, '128k')).rejects.toThrow(/超时/)
  }, 5000)

  it('exposes currentScriptInfo from header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-src-'))
    const file = join(dir, 'meta.js')
    writeFileSync(
      file,
      `/**
 * @name 测试源
 * @version 1.2.3
 * @author demo
 */
const { EVENT_NAMES, on, send, currentScriptInfo } = globalThis.lx
if (!currentScriptInfo.rawScript || currentScriptInfo.name !== '测试源') throw new Error('missing script info')
on(EVENT_NAMES.request, async () => 'http://example.com/a.mp3')
send(EVENT_NAMES.inited, { sources: { wy: { qualitys: ['128k'] } } })
`,
      'utf8',
    )
    const handle = await loadLxSource(file, { bypassCache: true })
    expect(handle.platforms).toContain('wy')
  })

  it('parses script header fields', () => {
    const info = parseScriptHeader('/**\n * @name 花\n * @version 1\n */\n')
    expect(info.name).toBe('花')
    expect(info.version).toBe('1')
  })

  it('waits for async inited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-src-'))
    const file = join(dir, 'async-init.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, async () => 'http://example.com/a.mp3')
      setTimeout(() => {
        send(EVENT_NAMES.inited, { sources: { tx: { qualitys: ['128k', '320k'] } } })
      }, 30)
      `,
      'utf8',
    )
    const handle = await loadLxSource(file, { bypassCache: true })
    expect(handle.platforms).toEqual(['tx'])
  }, 5000)

  it('classifies DNS failures as benign network errors', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND api.ikunshare.com'), {
      code: 'ENOTFOUND',
    })
    expect(isBenignSourceNetworkError(err)).toBe(true)
    expect(isBenignSourceNetworkError(new Error('业务逻辑错误'))).toBe(false)
  })

  it('classifies undefined property access as benign script errors', () => {
    const err = new Error("Cannot read properties of undefined (reading '0')")
    expect(isBenignSourceScriptError(err)).toBe(true)
    expect(isBenignSourceNetworkError(err)).toBe(false)
    expect(isBenignSourceScriptError(new Error('业务逻辑错误'))).toBe(false)
  })

  it('captures fire-and-forget checkUpdate network rejection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-src-'))
    const file = join(dir, 'check-update.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send, request } = globalThis.lx
      on(EVENT_NAMES.request, async () => 'http://example.com/a.mp3')
      send(EVENT_NAMES.inited, { sources: { wy: { qualitys: ['128k'] } } })
      // 模拟音源未 catch 的 checkUpdate
      Promise.resolve().then(() =>
        request('https://api.ikunshare.com/script/lxmusic?checkUpdate=1', { method: 'GET' }),
      )
      `,
      'utf8',
    )
    const guard = acquireSourceRejectionGuard()
    try {
      await loadLxSource(file, { bypassCache: true })
      const errs = await settleSourceNetworkErrors(guard, 3000)
      expect(errs.length).toBeGreaterThan(0)
      expect(isBenignSourceNetworkError(errs[0])).toBe(true)
    } finally {
      guard.release()
    }
  }, 15000)
})

describe('real lx sources compatibility', () => {
  beforeEach(() => resetSourceRuntimeState())
  afterEach(() => resetSourceRuntimeState())

  const samples: Array<{ name: string; path: string }> = [
    { name: 'huibq', path: '/tmp/miyin-src-check/huibq.js' },
    { name: 'lx', path: '/tmp/miyin-src-check/lx.js' },
    { name: 'flower', path: '/tmp/miyin-src-check/flower.js' },
  ]

  for (const sample of samples) {
    it(
      `loads ${sample.name}`,
      async () => {
        if (!existsSync(sample.path)) return
        const dir = mkdtempSync(join(tmpdir(), 'miyin-real-'))
        const file = join(dir, `${sample.name}.js`)
        copyFileSync(sample.path, file)
        const handle = await loadLxSource(file, { bypassCache: true })
        expect(handle.platforms.length).toBeGreaterThan(0)
      },
      20000,
    )
  }
})
