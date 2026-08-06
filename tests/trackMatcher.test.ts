import { describe, it, expect } from 'vitest'
import { matchTrack } from '../server/services/trackMatcher'

describe('matchTrack', () => {
  it('prefers external id on same platform', () => {
    const selected = matchTrack(
      { externalId: '123', title: '晴天', artist: '周杰伦', platform: 'wy' },
      {
        candidatesFromSearch: [
          { externalId: '999', title: '晴天', artist: '周杰伦' },
          { externalId: '123', title: '晴天', artist: '周杰伦' },
        ],
      },
    )
    expect(selected.method).toBe('id')
    expect(selected.selected?.externalId).toBe('123')
  })

  it('falls back to metadata score', () => {
    const selected = matchTrack(
      { title: '晴天', artist: '周杰伦', platform: 'wy' },
      {
        candidatesFromSearch: [
          { title: '晴天', artist: '其他人' },
          { title: '晴天', artist: '周杰伦' },
        ],
      },
    )
    expect(selected.method).toBe('metadata')
    expect(selected.selected?.artist).toContain('周杰伦')
  })
})
