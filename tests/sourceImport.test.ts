import { describe, it, expect } from 'vitest'
import { parseSourceText, allocateUniqueName, cleanSourceName } from '../server/services/sourceImport'

describe('cleanSourceName', () => {
  it('strips surrounding symbols and trailing colon', () => {
    expect(cleanSourceName('惠布克：')).toBe('惠布克')
    expect(cleanSourceName('【花】')).toBe('花')
    expect(cleanSourceName('「六阴」')).toBe('六阴')
    expect(cleanSourceName('- LX -')).toBe('LX')
    expect(cleanSourceName('名称:')).toBe('名称')
  })
})

describe('parseSourceText', () => {
  it('parses name-url pairs', () => {
    const sample = `
六阴
https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js
惠布克
https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js
`
    const list = parseSourceText(sample)
    expect(list).toEqual([
      { name: '六阴', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js' },
      { name: '惠布克', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js' },
    ])
  })

  it('parses url-only lines', () => {
    const list = parseSourceText('https://example.com/a.js\nhttps://example.com/b.js')
    expect(list).toHaveLength(2)
    expect(list[0].url).toContain('a.js')
    expect(list[0].name).toBeTruthy()
  })

  it('parses same-line name and url with colon', () => {
    const list = parseSourceText('惠布克：https://example.com/huibq.js\n花 https://example.com/flower.js')
    expect(list).toEqual([
      { name: '惠布克', url: 'https://example.com/huibq.js' },
      { name: '花', url: 'https://example.com/flower.js' },
    ])
  })

  it('cleans decorated names on separate lines', () => {
    const list = parseSourceText('【LX】：\nhttps://example.com/lx.js')
    expect(list[0].name).toBe('LX')
    expect(list[0].url).toBe('https://example.com/lx.js')
  })

  it('keeps proxy and direct urls as distinct', () => {
    const list = parseSourceText(`
惠布克
https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js
惠布克
https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js
`)
    expect(list).toHaveLength(2)
    expect(list[0].url).toContain('ghproxy.net')
    expect(list[1].url).not.toContain('ghproxy.net')
  })
})

describe('allocateUniqueName', () => {
  it('returns base when free', () => {
    expect(allocateUniqueName('惠布克', new Set())).toBe('惠布克')
  })

  it('appends (2)/(3) when taken', () => {
    const taken = new Set(['惠布克', '惠布克 (2)'])
    expect(allocateUniqueName('惠布克', taken)).toBe('惠布克 (3)')
  })
})
