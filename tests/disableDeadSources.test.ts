import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  disableDeadSources,
  listEnabledDeadSources,
} from '../server/services/sourceRegistry'

describe('disableDeadSources', () => {
  let prevDataDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-disable-dead-'))
    getDb()
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
  })

  function insertSource(row: {
    id: string
    name: string
    status: string
    enabled: number
  }) {
    const ts = new Date().toISOString()
    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, mirror_url, local_path, enabled, status, platforms, last_checked_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, '[]', ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.name,
        `https://example.com/${row.id}.js`,
        row.enabled,
        row.status,
        ts,
        row.status === 'dead' ? 'probe failed' : null,
        ts,
        ts,
      )
  }

  it('disables only enabled dead sources', () => {
    insertSource({ id: 'a', name: '异常启用', status: 'dead', enabled: 1 })
    insertSource({ id: 'b', name: '异常已停', status: 'dead', enabled: 0 })
    insertSource({ id: 'c', name: '正常启用', status: 'ok', enabled: 1 })

    expect(listEnabledDeadSources()).toHaveLength(1)

    const res = disableDeadSources()
    expect(res.disabled).toBe(1)
    expect(res.ids).toEqual(['a'])
    expect(res.names).toEqual(['异常启用'])

    const rows = getDb().prepare('SELECT id, enabled, status FROM sources ORDER BY id').all() as Array<{
      id: string
      enabled: number
      status: string
    }>
    expect(rows).toEqual([
      { id: 'a', enabled: 0, status: 'dead' },
      { id: 'b', enabled: 0, status: 'dead' },
      { id: 'c', enabled: 1, status: 'ok' },
    ])
  })

  it('returns zero when none to disable', () => {
    insertSource({ id: 'ok1', name: '正常', status: 'ok', enabled: 1 })
    const res = disableDeadSources()
    expect(res).toEqual({ disabled: 0, ids: [], names: [] })
  })
})
