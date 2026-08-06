import { describe, it, expect } from 'vitest'
import { verifySession, createSessionToken } from '../server/utils/crypto'
import { nextStatusAfterFailure } from '../server/services/downloadState'
import { openDb } from '../server/utils/db'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('auth session', () => {
  it('rejects missing session', () => {
    expect(verifySession(undefined, 'secret')).toBeNull()
    expect(verifySession('bad', 'secret')).toBeNull()
  })

  it('accepts valid session', () => {
    const token = createSessionToken('secret')
    expect(verifySession(token, 'secret')).toBeTruthy()
  })
})

describe('db', () => {
  it('creates schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-'))
    const db = openDb(dir)
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sources'`).get()
    expect(row).toBeTruthy()
    db.close()
  })
})

describe('download failover state', () => {
  it('requeues when failover available', () => {
    expect(
      nextStatusAfterFailure({ attempts: 1, maxAttempts: 3, autoFailover: true, hasAltSource: true }),
    ).toBe('queued')
  })

  it('fails when attempts exhausted', () => {
    expect(
      nextStatusAfterFailure({ attempts: 3, maxAttempts: 3, autoFailover: true, hasAltSource: true }),
    ).toBe('failed')
  })
})
