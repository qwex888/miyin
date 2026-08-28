import { describe, expect, it } from 'vitest'
import { compareSemver, isNewerVersion, parseSemver } from '../shared/appUpdate'

describe('semver helpers', () => {
  it('parses version with optional v prefix', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3])
    expect(parseSemver('0.4.2')).toEqual([0, 4, 2])
  })

  it('compares semver segments', () => {
    expect(compareSemver('0.4.3', '0.4.2')).toBe(1)
    expect(compareSemver('0.4.2', '0.4.2')).toBe(0)
    expect(compareSemver('0.3.9', '0.4.0')).toBe(-1)
  })

  it('detects newer remote version', () => {
    expect(isNewerVersion('0.5.0', '0.4.2')).toBe(true)
    expect(isNewerVersion('0.4.2', '0.4.2')).toBe(false)
    expect(isNewerVersion('0.4.1', '0.4.2')).toBe(false)
  })
})
