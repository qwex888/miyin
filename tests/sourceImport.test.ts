import { describe, it, expect } from 'vitest'
import { parseSourceText } from '../server/services/sourceImport'

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
})
