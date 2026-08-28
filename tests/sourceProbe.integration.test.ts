import { describe, it, expect, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetSourceRuntimeState } from '../server/services/sourceRuntime'
import { probeLocalScript } from '../server/services/sourceProbe'

describe('sourceProbe integration', () => {
  beforeEach(() => resetSourceRuntimeState())

  it('marks ok when probe getMusicUrl succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-probe-'))
    const file = join(dir, 'ok.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, async () => 'https://example.com/track.mp3')
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
      `,
      'utf8',
    )
    const r = await probeLocalScript(file)
    expect(r.status).toBe('ok')
    expect(r.lastError).toBeNull()
  })

  it('marks dead with classified error when API returns suspended-like response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-probe-'))
    const file = join(dir, 'bad.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, async () => {
        throw new Error('unknow error')
      })
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
      `,
      'utf8',
    )
    const r = await probeLocalScript(file)
    expect(r.status).toBe('dead')
    expect(r.lastError).toMatch(/取链探针失败/)
    expect(r.lastError).toMatch(/API 返回异常/)
  })

  it('includes updateAlert hint on probe failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-probe-'))
    const file = join(dir, 'old.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      send(EVENT_NAMES.updateAlert, { log: '当前源脚本版本过低，请下载最新版本' })
      on(EVENT_NAMES.request, async () => { throw new Error('404 Not Found') })
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
      `,
      'utf8',
    )
    const r = await probeLocalScript(file)
    expect(r.status).toBe('dead')
    expect(r.lastError).toContain('404')
    expect(r.lastError).toContain('版本过低')
  })
})
