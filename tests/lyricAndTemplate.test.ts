import { describe, it, expect } from 'vitest'
import { mergeBilingualLyrics, parseLrcLines } from '../server/services/lyricService'
import { applyNameTemplate } from '../server/services/downloadQueue'

describe('bilingual lyrics', () => {
  it('merges same timestamp into two lines', () => {
    const merged = mergeBilingualLyrics(
      '[00:01.00]こんにちは\n[00:02.00]世界',
      '[00:01.00]konnichiwa\n[00:02.00]sekai',
    )
    expect(merged).toContain('[00:01.00]こんにちは')
    expect(merged).toContain('[00:01.00]konnichiwa')
    expect(parseLrcLines(merged).filter((l) => l.time === '00:01.00')).toHaveLength(2)
  })

  it('returns original when no translation', () => {
    expect(mergeBilingualLyrics('[00:01.00]hello', '')).toBe('[00:01.00]hello')
  })
})

describe('name template', () => {
  it('replaces all known vars', () => {
    const name = applyNameTemplate('{artist} - {title} [{platform}/{quality}] #{track}', {
      artist: 'A',
      title: 'B',
      platform: 'wy',
      quality: '320k',
      track: 3,
    })
    expect(name).toBe('A - B [wy_320k] #3')
  })
})
