import { describe, it, expect, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSandboxedSync, resetSourceRuntimeState, loadLxSource } from '../server/services/sourceRuntime'

describe('source sandbox', () => {
  beforeEach(() => resetSourceRuntimeState())

  it('kills sync infinite loop via vm timeout', () => {
    expect(() => runSandboxedSync('while(true){}', 50)).toThrow()
  })

  it('rejects blocked require', () => {
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
    expect(() => loadLxSource(file, { bypassCache: true })).toThrow(/禁止 require/)
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
    const handle = loadLxSource(file, { bypassCache: true })
    await expect(handle.getMusicUrl('wy', { songmid: '1' }, '128k')).rejects.toThrow(/超时/)
  }, 5000)
})
