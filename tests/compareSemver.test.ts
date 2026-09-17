import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  isNewerVersion,
  parseSemver,
  shouldRunBootUpdateCheck,
  shouldShowAppUpdateBadge,
} from '../shared/appUpdate'

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

describe('shouldShowAppUpdateBadge', () => {
  it('shows badge when update exists and not dismissed', () => {
    expect(shouldShowAppUpdateBadge(true, '0.5.1', null)).toBe(true)
  })

  it('hides badge when this version was ignored', () => {
    expect(shouldShowAppUpdateBadge(true, '0.5.1', '0.5.1')).toBe(false)
  })

  it('hides badge when there is no update or no latest version', () => {
    expect(shouldShowAppUpdateBadge(false, '0.5.1', null)).toBe(false)
    expect(shouldShowAppUpdateBadge(true, null, null)).toBe(false)
    expect(shouldShowAppUpdateBadge(true, '', null)).toBe(false)
  })
})

describe('shouldRunBootUpdateCheck', () => {
  it('runs when already logged in', () => {
    expect(
      shouldRunBootUpdateCheck({
        path: '/',
        authRequired: true,
        loggedIn: true,
      }),
    ).toBe(true)
  })

  it('runs in open mode (empty token)', () => {
    expect(
      shouldRunBootUpdateCheck({
        path: '/settings',
        authRequired: false,
        loggedIn: false,
      }),
    ).toBe(true)
  })

  it('skips on login page or when auth required but not logged in', () => {
    expect(
      shouldRunBootUpdateCheck({
        path: '/login',
        authRequired: true,
        loggedIn: false,
      }),
    ).toBe(false)
    expect(
      shouldRunBootUpdateCheck({
        path: '/',
        authRequired: true,
        loggedIn: false,
      }),
    ).toBe(false)
  })
})
