import { existsSync, readFileSync } from 'node:fs'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import {
  addSourceFromScript,
  findSourceByName,
  findSourceByUrl,
  getSource,
  listSources,
  saveSourceScript,
  updateSource,
  type SourceRow,
} from './sourceRegistry'
import { allocateUniqueName, cleanSourceName } from './sourceImport'
import type { SourceProgressReporter } from '#shared/sourceBatchProgress'
import {
  SOURCE_ITEM_TIMEOUT_MS,
  createBatchDeadline,
  reportProgress,
  withTimeout,
} from '../utils/sourceBatchTimeout'

export const BUNDLE_VERSION = 1

export type BundleManifestSource = {
  id: string
  name: string
  url: string
  enabled?: boolean
  script: string
}

export type BundleManifest = {
  version: number
  exportedAt: string
  sources: BundleManifestSource[]
}

export type BundleConflict = {
  id: string
  name: string
  url: string
  existingId: string
  existingName: string
  reason: 'id' | 'url'
}

export type BundlePreviewItem = {
  id: string
  name: string
  url: string
  enabled: boolean
  script: string
  conflict?: BundleConflict
}

function dateStamp(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function buildSourcesExportZip(opts?: { ids?: string[] }): {
  filename: string
  buffer: Buffer
  exported: number
  skipped: number
  skippedNames: string[]
} {
  const all = listSources()
  const rows = opts?.ids?.length ? all.filter((r) => opts.ids!.includes(r.id)) : all

  const sources: BundleManifestSource[] = []
  const files: Record<string, Uint8Array> = {}
  const skippedNames: string[] = []

  for (const row of rows) {
    if (!row.local_path || !existsSync(row.local_path)) {
      skippedNames.push(row.name)
      continue
    }
    const scriptPath = `scripts/${row.id}.js`
    const script = readFileSync(row.local_path)
    files[scriptPath] = new Uint8Array(script)
    sources.push({
      id: row.id,
      name: row.name,
      url: row.url,
      enabled: row.enabled === 1,
      script: scriptPath,
    })
  }

  const manifest: BundleManifest = {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    sources,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))

  const zipped = zipSync(files, { level: 6 })
  return {
    filename: `miyin-sources-${dateStamp()}.zip`,
    buffer: Buffer.from(zipped),
    exported: sources.length,
    skipped: skippedNames.length,
    skippedNames,
  }
}

function resolveConflict(entry: { id: string; name: string; url: string }): BundleConflict | undefined {
  const byId = getSource(entry.id)
  if (byId) {
    return {
      id: entry.id,
      name: entry.name,
      url: entry.url,
      existingId: byId.id,
      existingName: byId.name,
      reason: 'id',
    }
  }
  const byUrl = findSourceByUrl(entry.url)
  if (byUrl) {
    return {
      id: entry.id,
      name: entry.name,
      url: entry.url,
      existingId: byUrl.id,
      existingName: byUrl.name,
      reason: 'url',
    }
  }
  return undefined
}

export function parseSourcesBundle(zipBuffer: Buffer): BundlePreviewItem[] {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(new Uint8Array(zipBuffer))
  } catch {
    throw createError({ statusCode: 400, statusMessage: '无法解析 zip 文件' })
  }

  const manifestEntry =
    unzipped['manifest.json'] ||
    unzipped['./manifest.json'] ||
    Object.entries(unzipped).find(([k]) => k.endsWith('manifest.json'))?.[1]

  if (!manifestEntry) {
    throw createError({ statusCode: 400, statusMessage: '完整包缺少 manifest.json' })
  }

  let manifest: BundleManifest
  try {
    manifest = JSON.parse(strFromU8(manifestEntry)) as BundleManifest
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'manifest.json 不是合法 JSON' })
  }

  if (!manifest || !Array.isArray(manifest.sources)) {
    throw createError({ statusCode: 400, statusMessage: 'manifest.json 格式无效' })
  }
  if (manifest.version && manifest.version > BUNDLE_VERSION) {
    throw createError({
      statusCode: 400,
      statusMessage: `不支持的完整包版本 ${manifest.version}（当前支持 ${BUNDLE_VERSION}）`,
    })
  }

  const items: BundlePreviewItem[] = []
  for (const raw of manifest.sources) {
    const id = String(raw?.id || '').trim()
    const name = cleanSourceName(String(raw?.name || ''))
    const url = String(raw?.url || '').trim()
    const scriptRel = String(raw?.script || '').replace(/^\.\//, '')
    if (!id || !name || name === 'unnamed' || !url || !scriptRel) {
      continue
    }
    const scriptBytes =
      unzipped[scriptRel] ||
      unzipped[`./${scriptRel}`] ||
      unzipped[`scripts/${id}.js`]
    if (!scriptBytes) {
      continue
    }
    const script = strFromU8(scriptBytes)
    if (script.trim().length < 20) continue

    const entry = {
      id,
      name,
      url,
      enabled: raw.enabled !== false,
      script,
    }
    items.push({
      ...entry,
      conflict: resolveConflict(entry),
    })
  }

  if (!items.length) {
    throw createError({ statusCode: 400, statusMessage: '完整包中没有可用音源' })
  }
  return items
}

export function previewSourcesBundle(zipBuffer: Buffer) {
  const items = parseSourcesBundle(zipBuffer)
  const conflicts = items.filter((i) => i.conflict).map((i) => i.conflict!)
  return {
    total: items.length,
    newCount: items.length - conflicts.length,
    conflictCount: conflicts.length,
    conflicts,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      url: i.url,
      enabled: i.enabled,
      hasConflict: Boolean(i.conflict),
      conflict: i.conflict,
    })),
  }
}

export async function applySourcesBundle(
  zipBuffer: Buffer,
  onConflict: 'overwrite' | 'skip',
  opts?: { onProgress?: SourceProgressReporter },
): Promise<{
  total: number
  imported: number
  overwritten: number
  skipped: number
  failed: number
  timedOut: boolean
  results: Array<Record<string, any>>
}> {
  const items = parseSourcesBundle(zipBuffer)
  const total = items.length
  const deadline = createBatchDeadline(total)
  const results: Array<Record<string, any>> = []
  let imported = 0
  let overwritten = 0
  let skipped = 0
  let failed = 0
  let timedOut = false

  for (let i = 0; i < items.length; i++) {
    const index = i + 1
    const item = items[i]!

    if (deadline.isExpired()) {
      timedOut = true
      for (let j = i; j < items.length; j++) {
        const left = items[j]!
        failed += 1
        await reportProgress(opts?.onProgress, {
          index: j + 1,
          total,
          name: left.name,
          status: 'failed',
          error: '整批超时',
        })
        results.push({
          ok: false,
          name: left.name,
          url: left.url,
          error: '整批超时',
        })
      }
      break
    }

    try {
      if (item.conflict) {
        if (onConflict === 'skip') {
          skipped += 1
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: item.name,
            status: 'skipped',
            error: `冲突已跳过（与「${item.conflict.existingName}」）`,
          })
          results.push({
            ok: false,
            skipped: true,
            name: item.name,
            url: item.url,
            error: `冲突已跳过（与「${item.conflict.existingName}」）`,
          })
          continue
        }

        await withTimeout(
          (async () => {
            const targetId = item.conflict!.existingId
            const existing = getSource(targetId) as SourceRow
            let name = item.name
            const nameOwner = findSourceByName(name)
            if (nameOwner && nameOwner.id !== targetId) {
              const taken = new Set(listSources().map((s) => s.name))
              name = allocateUniqueName(name, taken)
            }
            await saveSourceScript(targetId, {
              script: item.script,
              name,
              onPhase: async (status) => {
                await reportProgress(opts?.onProgress, {
                  index,
                  total,
                  name,
                  status,
                })
              },
            })
            if (typeof item.enabled === 'boolean' && (item.enabled ? 1 : 0) !== existing.enabled) {
              updateSource(targetId, { enabled: item.enabled })
            }
            overwritten += 1
            results.push({ ok: true, overwritten: true, id: targetId, name })
            await reportProgress(opts?.onProgress, {
              index,
              total,
              name,
              status: 'done',
            })
          })(),
          SOURCE_ITEM_TIMEOUT_MS,
          `音源「${item.name}」`,
        )
        continue
      }

      await withTimeout(
        (async () => {
          await addSourceFromScript({
            id: item.id,
            name: item.name,
            url: item.url,
            script: item.script,
            enabled: item.enabled,
            onPhase: async (status) => {
              await reportProgress(opts?.onProgress, {
                index,
                total,
                name: item.name,
                status,
              })
            },
          })
          imported += 1
          results.push({ ok: true, imported: true, id: item.id, name: item.name })
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: item.name,
            status: 'done',
          })
        })(),
        SOURCE_ITEM_TIMEOUT_MS,
        `音源「${item.name}」`,
      )
    } catch (err: any) {
      failed += 1
      const message = err?.message || String(err)
      await reportProgress(opts?.onProgress, {
        index,
        total,
        name: item.name,
        status: 'failed',
        error: message,
      })
      results.push({
        ok: false,
        name: item.name,
        url: item.url,
        error: message,
      })
    }
  }

  return {
    total,
    imported,
    overwritten,
    skipped,
    failed,
    timedOut,
    results,
  }
}
