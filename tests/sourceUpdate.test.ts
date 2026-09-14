import { describe, it, expect } from 'vitest'
import {
  isDirectSourceScriptUrl,
  mergeSourceUpdateInfo,
  parseSourceUpdateHint,
} from '../shared/sourceUpdate'

describe('parseSourceUpdateHint', () => {
  it('parses updateAlert-style object', () => {
    const info = parseSourceUpdateHint({
      version: '1.3.0',
      updateUrl: 'https://cdn.example.com/source.js',
      description: '请尽快更新',
      log: '发现新版本',
    })
    expect(info).toEqual({
      version: '1.3.0',
      updateUrl: 'https://cdn.example.com/source.js',
      description: '请尽快更新',
      message: '发现新版本',
    })
  })

  it('parses console-style string + object pair via merge', () => {
    const a = parseSourceUpdateHint('发现新版本,需要更新,脚本将不会初始化:')
    const b = parseSourceUpdateHint({
      version: '1.3.0',
      updateUrl: 'https://www.yuque.com/kejichangqing/doc',
      description: '长青svip音源更新，请尽快更新！',
    })
    const merged = mergeSourceUpdateInfo(a, b)
    expect(merged?.version).toBe('1.3.0')
    expect(merged?.updateUrl).toContain('yuque.com')
    expect(merged?.message).toContain('发现新版本')
  })

  it('parses inspect-style log line', () => {
    const info = parseSourceUpdateHint(
      "发现新版本,需要更新,脚本将不会初始化: { version: '1.3.0', updateUrl: 'https://example.com/a.js', description: '更新' }",
    )
    expect(info?.version).toBe('1.3.0')
    expect(info?.updateUrl).toBe('https://example.com/a.js')
  })
})

describe('isDirectSourceScriptUrl', () => {
  it('accepts .js and raw hosts', () => {
    expect(isDirectSourceScriptUrl('https://cdn.example.com/foo.js')).toBe(true)
    expect(isDirectSourceScriptUrl('https://cdn.example.com/foo.js?token=1')).toBe(true)
    expect(
      isDirectSourceScriptUrl('https://raw.githubusercontent.com/user/repo/main/source.js'),
    ).toBe(true)
  })

  it('rejects documentation pages', () => {
    expect(
      isDirectSourceScriptUrl(
        'https://www.yuque.com/kejichangqing/qi42gn/gmnk4ayambra3x5m?singleDoc#',
      ),
    ).toBe(false)
    expect(isDirectSourceScriptUrl('https://example.com/download')).toBe(false)
  })
})
