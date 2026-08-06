import { describe, it, expect } from 'vitest'
import {
  parseIntervalToSeconds,
  isLikelyPreviewByAbsoluteDuration,
  isLikelyPreviewClip,
  minFullTrackBytes,
  isLikelyPreviewUrl,
} from '../server/utils/audioPreview'

describe('parseIntervalToSeconds', () => {
  it('parses mm:ss and number', () => {
    expect(parseIntervalToSeconds('4:28')).toBe(268)
    expect(parseIntervalToSeconds('1:02:03')).toBe(3723)
    expect(parseIntervalToSeconds(268)).toBe(268)
    expect(parseIntervalToSeconds(268000)).toBe(268)
  })
})

describe('isLikelyPreviewClip', () => {
  it('flags 20s/35s/60s against full song interval', () => {
    expect(isLikelyPreviewClip(20, 268)).toBe(true)
    expect(isLikelyPreviewClip(35, 293)).toBe(true)
    expect(isLikelyPreviewClip(60, 272)).toBe(true)
    expect(isLikelyPreviewClip(176, 176)).toBe(false)
    expect(isLikelyPreviewClip(120, 176)).toBe(false)
  })

  it('does not flag short songs with proportional length', () => {
    expect(isLikelyPreviewClip(40, 50)).toBe(false)
  })
})

describe('isLikelyPreviewByAbsoluteDuration', () => {
  it('flags QQ 60s trial when size is small', () => {
    expect(isLikelyPreviewByAbsoluteDuration(60, 961_077)).toBe(true)
    expect(isLikelyPreviewByAbsoluteDuration(60.0, 900_000)).toBe(true)
  })

  it('allows ~60s track with full-song bitrate size', () => {
    expect(isLikelyPreviewByAbsoluteDuration(60, 3_000_000)).toBe(false)
  })
})

describe('preview helpers', () => {
  it('detects preview-ish urls and size floor', () => {
    expect(isLikelyPreviewUrl('https://cdn.example/preview/abc.mp3')).toBe(true)
    expect(isLikelyPreviewUrl('https://cdn.example/full/abc.mp3')).toBe(false)
    expect(minFullTrackBytes(268, '320k')).toBeGreaterThan(500_000)
  })
})
