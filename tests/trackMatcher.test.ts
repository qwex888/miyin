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

  it('falls back metadata score', () => {
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

  it('does not score candidates whose title normalizes to empty (e.g. fully bracketed)', () => {
    const selected = matchTrack(
      { title: '不存在的歌', artist: ' nobody ', platform: 'wy' },
      {
        candidatesFromSearch: [
          // norm 后为空串：includes('') 恒真，修复前可凭 0.35 + 歌手分越过阈值
          { externalId: 'bad', title: '（伴奏）', artist: ' nobody ', album: '', duration: 100 },
          { externalId: 'ok', title: '别的歌', artist: '别人', album: '', duration: 200 },
        ],
      },
    )
    expect(selected.selected?.externalId).not.toBe('bad')
  })

  it('does not score when track artist first segment is empty', () => {
    const selected = matchTrack(
      { title: '某首歌', artist: '/合唱团', platform: 'wy' },
      {
        candidatesFromSearch: [
          { externalId: 'any', title: '完全不同', artist: '任何人', album: '', duration: 100 },
        ],
      },
    )
    expect(selected.selected).toBeNull()
  })

  it('does not score album match when both albums are empty', () => {
    const selected = matchTrack(
      { title: '甲', artist: '乙', album: '', platform: 'wy' },
      {
        candidatesFromSearch: [
          // 标题/歌手都不匹配，专辑也为空 → 总分为 0，不应被选中
          { externalId: 'x', title: '丙', artist: '丁', album: '', duration: 1 },
        ],
      },
    )
    expect(selected.selected).toBeNull()
  })
})
