import { describe, it, expect } from 'vitest'
import { cleanArtist } from '../server/services/platformSearch'

describe('cleanArtist', () => {
  it('strips dirty netease suffix', () => {
    expect(cleanArtist('周杰伦- / A-LNK')).toBe('周杰伦')
  })

  it('keeps normal artists', () => {
    expect(cleanArtist('周杰伦 / 费玉清')).toBe('周杰伦 / 费玉清')
  })
})
