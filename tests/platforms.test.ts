import { describe, expect, it } from 'vitest'
import {
  PLATFORM_DISPLAY,
  PLAYLIST_PLATFORM_ORDER,
  platformLabel,
  platformListText,
} from '../shared/platforms'

describe('platform display map', () => {
  it('labels follow PLATFORM_DISPLAY values', () => {
    expect(platformLabel('wy')).toBe(PLATFORM_DISPLAY.wy)
    expect(platformLabel('kg')).toBe(PLATFORM_DISPLAY.kg)
    expect(platformLabel('unknown')).toBe('unknown')
  })

  it('joins playlist platforms from the map', () => {
    expect(platformListText(PLAYLIST_PLATFORM_ORDER)).toBe(
      PLAYLIST_PLATFORM_ORDER.map((id) => PLATFORM_DISPLAY[id]).join(' / '),
    )
  })
})
