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

  it('captures structured updateInfo from updateAlert payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-probe-'))
    const file = join(dir, 'need-update.js')
    writeFileSync(
      file,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      send(EVENT_NAMES.updateAlert, {
        version: '1.3.0',
        updateUrl: 'https://www.yuque.com/demo/doc',
        description: '请尽快更新！',
        log: '发现新版本',
      })
      console.log('发现新版本,需要更新,脚本将不会初始化:', {
        version: '1.3.0',
        updateUrl: 'https://www.yuque.com/demo/doc',
        description: '请尽快更新！',
      })
      on(EVENT_NAMES.request, async () => {
        throw new Error('需要更新后才能使用')
      })
      send(EVENT_NAMES.inited, { status: true, sources: { wy: { qualitys: ['128k'] } } })
    `,
      'utf8',
    )
    const r = await probeLocalScript(file)
    expect(r.status).toBe('dead')
    expect(r.updateInfo?.version).toBe('1.3.0')
    expect(r.updateInfo?.updateUrl).toContain('yuque.com')
  })
})
