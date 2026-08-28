import { describe, it, expect } from 'vitest'
import {
  buildQualityAttempts,
  buildGlobalQualityLadder,
  shouldTryQualityOnSource,
  isHighestQuality,
  normalizeMusicInfo,
  pickQuality,
} from '../server/services/musicUrlResolve'

describe('musicUrlResolve helpers', () => {
  it('detects highest preference', () => {
    expect(isHighestQuality('highest')).toBe(true)
    expect(isHighestQuality('')).toBe(true)
    expect(isHighestQuality(null)).toBe(true)
    expect(isHighestQuality('flac')).toBe(false)
    expect(isHighestQuality('flac24bit')).toBe(false)
  })

  it('builds ladder including flac24bit for highest', () => {
    expect(buildQualityAttempts(['128k', '320k', 'flac', 'flac24bit'], 'highest')).toEqual([
      'flac24bit',
      'flac',
      '320k',
      '128k',
    ])
  })

  it('fixed quality only attempts that quality', () => {
    expect(buildQualityAttempts(['128k', '320k', 'flac', 'flac24bit'], 'flac')).toEqual(['flac'])
    expect(buildQualityAttempts(['128k', '320k'], 'flac24bit')).toEqual(['flac24bit'])
  })

  it('buildGlobalQualityLadder unions sources and orders by ladder', () => {
    expect(
      buildGlobalQualityLadder('highest', [
        ['128k', '320k'],
        ['flac', '128k'],
      ]),
    ).toEqual(['flac', '320k', '128k'])
    expect(buildGlobalQualityLadder('flac', [['128k', '320k']])).toEqual(['flac'])
  })

  it('shouldTryQualityOnSource skips unsupported tier on highest only', () => {
    expect(shouldTryQualityOnSource(['320k', '128k'], 'flac', true)).toBe(false)
    expect(shouldTryQualityOnSource(['320k', '128k'], '320k', true)).toBe(true)
    expect(shouldTryQualityOnSource(['128k'], 'flac', false)).toBe(true)
  })

  it('pickQuality prefers flac24bit on highest', () => {
    expect(pickQuality(['128k', 'flac24bit', 'flac'], 'highest')).toBe('flac24bit')
    expect(pickQuality(['128k', '320k'], 'flac')).toBe('flac')
  })

  it('normalizes id/songmid/hash', () => {
    const n = normalizeMusicInfo({ songmid: '2086317196', name: 'x' })
    expect(n.id).toBe('2086317196')
    expect(n.songmid).toBe('2086317196')
    expect(n.hash).toBe('2086317196')
  })
})
