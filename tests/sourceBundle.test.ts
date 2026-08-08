import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { addSourceFromScript, readSourceScript } from '../server/services/sourceRegistry'
import {
  applySourcesBundle,
  buildSourcesExportZip,
  previewSourcesBundle,
} from '../server/services/sourceBundle'
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

describe('source bundle export/import', () => {
  let dataDir: string
  let prevDataDir: string | undefined

  beforeEach(() => {
    resetSourceRuntimeState()
    closeDb()
    prevDataDir = process.env.DATA_DIR
    dataDir = mkdtempSync(join(tmpdir(), 'miyin-bundle-'))
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

  it('exports zip and re-imports after wipe (roundtrip)', async () => {
    const row = await addSourceFromScript({
      name: '测试源',
      script: MINI_SCRIPT + '\n// key=secret-one\n',
      url: 'https://example.com/test-source.js',
    })
    expect(row.last_error).toBeNull()
    expect(row.status).toBe('ok')

    const exported = buildSourcesExportZip()
    expect(exported.exported).toBe(1)
    expect(exported.buffer.length).toBeGreaterThan(50)

    // wipe
    getDb().prepare('DELETE FROM sources').run()
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM sources').get()).toEqual({ c: 0 })

    const preview = previewSourcesBundle(exported.buffer)
    expect(preview.total).toBe(1)
    expect(preview.conflictCount).toBe(0)

    const applied = await applySourcesBundle(exported.buffer, 'skip')
    expect(applied.imported).toBe(1)
    expect(applied.failed).toBe(0)

    const script = readSourceScript(row.id)
    expect(script).toContain('secret-one')
  })

  it('conflict: skip keeps old script; overwrite replaces', async () => {
    const row = await addSourceFromScript({
      name: '冲突源',
      script: MINI_SCRIPT + '\n// key=old\n',
      url: 'https://example.com/conflict.js',
    })

    const first = buildSourcesExportZip()
    // mutate local script then re-export as "incoming"
    await addSourceFromScript({
      name: '另一源',
      script: MINI_SCRIPT + '\n// key=other\n',
    })
    // Build a zip that conflicts on same url/id as first source
    const { zipSync, strToU8, unzipSync, strFromU8 } = await import('fflate')
    const unzipped = unzipSync(new Uint8Array(first.buffer))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json']!))
    const scriptPath = manifest.sources[0].script
    unzipped[scriptPath] = strToU8(MINI_SCRIPT + '\n// key=new\n')
    const conflictZip = Buffer.from(zipSync(unzipped))

    const preview = previewSourcesBundle(conflictZip)
    expect(preview.conflictCount).toBe(1)

    const skipped = await applySourcesBundle(conflictZip, 'skip')
    expect(skipped.skipped).toBe(1)
    expect(readSourceScript(row.id)).toContain('key=old')

    const overwritten = await applySourcesBundle(conflictZip, 'overwrite')
    expect(overwritten.overwritten).toBe(1)
    expect(readSourceScript(row.id)).toContain('key=new')
  })
})
