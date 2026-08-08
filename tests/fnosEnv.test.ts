import { describe, expect, it } from 'vitest'
import { pathCoveredByRoots } from '../server/utils/fnosEnv'

describe('pathCoveredByRoots', () => {
  it('matches exact path', () => {
    expect(pathCoveredByRoots('/vol1/music', ['/vol1/music'])).toBe(true)
  })

  it('matches child path', () => {
    expect(pathCoveredByRoots('/vol1/music/album', ['/vol1/music'])).toBe(true)
  })

  it('rejects sibling path', () => {
    expect(pathCoveredByRoots('/vol1/music2', ['/vol1/music'])).toBe(false)
  })
})
