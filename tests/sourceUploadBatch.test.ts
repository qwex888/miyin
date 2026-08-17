import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  addSourceFromScript,
  applySourcesFromFiles,
  previewSourcesFromFiles,
  readSourceScript,
} from '../server/services/sourceRegistry'
import { resetSourceRuntimeState } from '../server/services/sourceRuntime'

;(globalThis as any).createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => {
  const err = new Error(input.statusMessage || 'Error') as Error & {
    statusCode?: number
    data?: unknown
  }
  err.statusCode = input.statusCode
  err.data = input.data
  return err
}

const MINI_SCRIPT = `
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, async () => 'http://example.com/a.mp3')
send(EVENT_NAMES.inited, { sources: { wy: { qualitys: ['128k', '320k'] } } })
`.trim()

describe('batch js file upload conflicts', () => {
  let dataDir: string
  let prevDataDir: string | undefined

  beforeEach(() => {
    resetSourceRuntimeState()
    closeDb()
    prevDataDir = process.env.DATA_DIR
    dataDir = mkdtempSync(join(tmpdir(), 'miyin-upload-'))
    process.env.DATA_DIR = dataDir
    process.env.MIYIN_SOURCE_UPDATE_GRACE_MS = '0'
    process.env.MIYIN_SOURCE_INIT_WAIT_MS = '1000'
    getDb()
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
  })

  it('preview detects same-name conflict; skip keeps old; overwrite replaces', async () => {
    await addSourceFromScript({
      name: '惠布克',
      script: MINI_SCRIPT + '\n// key=old\n',
    })

    const files = [{ name: '惠布克.js', script: MINI_SCRIPT + '\n// key=new\n' }]
    const preview = previewSourcesFromFiles(files)
    expect(preview.conflictCount).toBe(1)
    expect(preview.newCount).toBe(0)
    expect(preview.conflicts[0]?.reason).toBe('name')

    const skipped = await applySourcesFromFiles(files, 'skip')
    expect(skipped.skipped).toBe(1)
    expect(skipped.imported).toBe(0)
    expect(readSourceScript(preview.conflicts[0]!.existingId)).toContain('key=old')

    const overwritten = await applySourcesFromFiles(files, 'overwrite')
    expect(overwritten.overwritten).toBe(1)
    expect(readSourceScript(preview.conflicts[0]!.existingId)).toContain('key=new')
  })

  it('single create renames on name conflict', async () => {
    await addSourceFromScript({ name: 'demo', script: MINI_SCRIPT + '\n// a\n' })
    const row = await addSourceFromScript({
      name: 'demo',
      script: MINI_SCRIPT + '\n// b\n',
      renameOnConflict: true,
    })
    expect(row.name).toBe('demo (2)')
  })

  it('batch duplicate basenames are conflicts', () => {
    const preview = previewSourcesFromFiles([
      { name: 'same.js', script: MINI_SCRIPT + '\n// 1\n' },
      { name: 'same.js', script: MINI_SCRIPT + '\n// 2\n' },
    ])
    expect(preview.total).toBe(2)
    expect(preview.newCount).toBe(1)
    expect(preview.conflictCount).toBe(1)
  })
})
