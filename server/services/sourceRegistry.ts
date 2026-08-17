import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { getDb } from '../utils/db'
import { getSourceCachePath } from '../utils/paths'
import { allocateUniqueName, cleanSourceName, parseSourceText } from './sourceImport'
import {
  acquireSourceRejectionGuard,
  loadLxSource,
  settleSourceNetworkErrors,
} from './sourceRuntime'
import type { SourceProgressReporter } from '#shared/sourceBatchProgress'
import {
  SOURCE_ITEM_TIMEOUT_MS,
  createBatchDeadline,
  reportProgress,
  withTimeout,
} from '../utils/sourceBatchTimeout'

export type SourceRow = {
  id: string
  name: string
  url: string
  mirror_url: string | null
  local_path: string | null
  enabled: number
  status: string
  platforms: string
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function nowIso() {
  return new Date().toISOString()
}

function idFromUrl(url: string) {
  return createHash('sha1').update(url).digest('hex').slice(0, 16)
}

function newLocalId() {
  return createHash('sha1').update(`local:${randomUUID()}`).digest('hex').slice(0, 16)
}

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url.trim())
}

async function probeLocalScript(localPath: string): Promise<{
  platforms: string[]
  status: string
  lastError: string | null
}> {
  let platforms: string[] = []
  let status = 'unknown'
  let lastError: string | null = null
  const guard = acquireSourceRejectionGuard()
  try {
    const handle = await loadLxSource(localPath, { bypassCache: true })
    platforms = handle.platforms
    const netErrs = await settleSourceNetworkErrors(guard)
    if (netErrs.length) {
      status = 'dead'
      lastError = `更新检测失败: ${netErrs[0]!.message}`
    } else {
      status = 'ok'
    }
  } catch (err: any) {
    status = 'dead'
    lastError = err?.message || String(err)
  } finally {
    guard.release()
  }
  return { platforms, status, lastError }
}

export function listSources(): SourceRow[] {
  return getDb().prepare('SELECT * FROM sources ORDER BY created_at DESC').all() as SourceRow[]
}

export function getSource(id: string): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
}

export function findSourceByUrl(url: string): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE url = ?').get(url) as SourceRow | undefined
}

export function findSourceByName(name: string): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE name = ?').get(name) as SourceRow | undefined
}

function existingNameSet(): Set<string> {
  const rows = getDb().prepare('SELECT name FROM sources').all() as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

export async function fetchSourceScript(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'miyin/0.1' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text || text.length < 20) throw new Error('脚本内容过短')
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function persistSource(input: {
  name: string
  url: string
  mirrorUrl?: string
  allowUpdate: boolean
  onPhase?: (status: 'loading' | 'configuring' | 'checking') => void | Promise<void>
}): Promise<SourceRow> {
  const id = idFromUrl(input.url)
  const existing = getSource(id)
  if (existing && !input.allowUpdate) {
    throw createError({ statusCode: 409, statusMessage: '该音源 URL 已存在' })
  }

  await input.onPhase?.('loading')
  const script = await fetchSourceScript(input.mirrorUrl || input.url)
  await input.onPhase?.('configuring')
  const localPath = getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')

  await input.onPhase?.('checking')
  const probed = await probeLocalScript(localPath)
  const platforms = probed.platforms
  const status = probed.status
  const lastError = probed.lastError

  const ts = nowIso()
  if (existing) {
    getDb()
      .prepare(
        `UPDATE sources SET name=?, url=?, mirror_url=?, local_path=?, status=?, platforms=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`,
      )
      .run(
        input.name,
        input.url,
        input.mirrorUrl || null,
        localPath,
        status,
        JSON.stringify(platforms),
        ts,
        lastError,
        ts,
        id,
      )
  } else {
    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, mirror_url, local_path, enabled, status, platforms, last_checked_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.url,
        input.mirrorUrl || null,
        localPath,
        status,
        JSON.stringify(platforms),
        ts,
        lastError,
        ts,
        ts,
      )
  }
  return getSource(id)!
}

/**
 * 手动新增：URL 全量精确匹配已存在 → 报错；名称已存在 → 报错。
 * 刷新/检测场景请用 upsertSourceFromRemote。
 */
export async function addSource(input: { name: string; url: string; mirrorUrl?: string }) {
  const url = input.url.trim()
  const name = cleanSourceName(input.name)
  if (!url || !name || name === 'unnamed') {
    throw createError({ statusCode: 400, statusMessage: 'name/url 必填' })
  }
  if (!/^https?:\/\//i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'URL 需以 http(s):// 开头' })
  }

  if (findSourceByUrl(url)) {
    throw createError({ statusCode: 409, statusMessage: '该音源 URL 已存在' })
  }
  if (findSourceByName(name)) {
    throw createError({ statusCode: 409, statusMessage: `音源名称「${name}」已存在，请修改名称后重试` })
  }

  return await persistSource({ name, url, mirrorUrl: input.mirrorUrl, allowUpdate: false })
}

/** 按 URL 写入或更新（检测/重新拉取脚本用） */
export async function upsertSourceFromRemote(input: { name: string; url: string; mirrorUrl?: string }) {
  return await persistSource({
    name: input.name,
    url: input.url,
    mirrorUrl: input.mirrorUrl,
    allowUpdate: true,
  })
}

/**
 * 批量导入：
 * - URL 全量精确匹配已存在或本批重复 → 自动跳过
 * - 名称冲突但 URL 不同 → 自动改名为「名称 (2)」…
 */
export async function importSourcesText(
  text: string,
  opts?: { onProgress?: SourceProgressReporter },
) {
  const parsed = parseSourceText(text)
  if (!parsed.length) {
    throw createError({ statusCode: 400, statusMessage: '未解析到任何音源 URL' })
  }

  const total = parsed.length
  const deadline = createBatchDeadline(total)
  const takenNames = existingNameSet()
  const seenUrls = new Set(listSources().map((s) => s.url))
  const results: Array<Record<string, any>> = []
  let skipped = 0
  let renamed = 0
  let failed = 0
  let timedOut = false

  for (let i = 0; i < parsed.length; i++) {
    const index = i + 1
    const item = parsed[i]!

    if (deadline.isExpired()) {
      timedOut = true
      for (let j = i; j < parsed.length; j++) {
        const left = parsed[j]!
        failed += 1
        await reportProgress(opts?.onProgress, {
          index: j + 1,
          total,
          name: left.name,
          status: 'failed',
          error: '整批超时',
        })
        results.push({ ok: false, name: left.name, url: left.url, error: '整批超时' })
      }
      break
    }

    if (seenUrls.has(item.url)) {
      skipped += 1
      await reportProgress(opts?.onProgress, {
        index,
        total,
        name: item.name,
        status: 'skipped',
        error: 'URL 已存在，已跳过',
      })
      results.push({
        ok: false,
        skipped: true,
        name: item.name,
        url: item.url,
        error: 'URL 已存在，已跳过',
      })
      continue
    }

    const finalName = allocateUniqueName(item.name, takenNames)
    if (finalName !== item.name) renamed += 1

    try {
      await withTimeout(
        (async () => {
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: finalName,
            status: 'loading',
          })
          const row = await persistSource({
            name: finalName,
            url: item.url,
            allowUpdate: false,
            onPhase: async (status) => {
              await reportProgress(opts?.onProgress, {
                index,
                total,
                name: finalName,
                status,
              })
            },
          })
          seenUrls.add(item.url)
          takenNames.add(finalName)
          results.push({
            ok: true,
            source: row,
            renamed: finalName !== item.name ? finalName : undefined,
          })
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: finalName,
            status: 'done',
          })
        })(),
        SOURCE_ITEM_TIMEOUT_MS,
        `音源「${finalName}」`,
      )
    } catch (err: any) {
      failed += 1
      const message = err?.message || String(err)
      await reportProgress(opts?.onProgress, {
        index,
        total,
        name: finalName,
        status: 'failed',
        error: message,
      })
      results.push({ ok: false, name: item.name, url: item.url, error: message })
    }
  }

  return {
    total,
    imported: results.filter((r) => r.ok).length,
    skipped,
    renamed,
    failed,
    timedOut,
    results,
  }
}

export function updateSource(id: string, patch: { enabled?: boolean; name?: string }) {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  const enabled = patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0
  const name = patch.name === undefined ? row.name : cleanSourceName(patch.name)
  if (!name || name === 'unnamed') {
    throw createError({ statusCode: 400, statusMessage: '名称无效' })
  }
  if (name !== row.name && findSourceByName(name)) {
    throw createError({ statusCode: 409, statusMessage: `音源名称「${name}」已存在，请修改名称后重试` })
  }
  getDb()
    .prepare('UPDATE sources SET enabled=?, name=?, updated_at=? WHERE id=?')
    .run(enabled, name, nowIso(), id)
  return getSource(id)!
}

export function readSourceScript(id: string): string {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  if (!row.local_path || !existsSync(row.local_path)) {
    throw createError({ statusCode: 404, statusMessage: '本地脚本文件不存在' })
  }
  return readFileSync(row.local_path, 'utf8')
}

/**
 * 用本地脚本内容新增音源（上传 / 粘贴脚本）。
 * url 可选；无 http(s) URL 时使用 local://<id>。
 */
export async function addSourceFromScript(input: {
  name: string
  script: string
  url?: string
  id?: string
  enabled?: boolean
  /** 单个新增：名称冲突时自动改成「名称 (2)」…；默认报错 */
  renameOnConflict?: boolean
  onPhase?: (status: 'loading' | 'configuring' | 'checking') => void | Promise<void>
}) {
  let name = cleanSourceName(input.name)
  const script = String(input.script || '')
  if (!name || name === 'unnamed') {
    throw createError({ statusCode: 400, statusMessage: '名称必填' })
  }
  if (!script || script.trim().length < 20) {
    throw createError({ statusCode: 400, statusMessage: '脚本内容过短' })
  }

  await input.onPhase?.('loading')

  let url = (input.url || '').trim()
  let id = (input.id || '').trim()

  if (url && isHttpUrl(url)) {
    if (findSourceByUrl(url)) {
      throw createError({ statusCode: 409, statusMessage: '该音源 URL 已存在' })
    }
    id = id || idFromUrl(url)
  } else {
    id = id || newLocalId()
    url = url || `local://${id}`
    if (findSourceByUrl(url)) {
      throw createError({ statusCode: 409, statusMessage: '该音源已存在' })
    }
  }

  if (getSource(id)) {
    throw createError({ statusCode: 409, statusMessage: '音源 ID 已存在' })
  }
  if (findSourceByName(name)) {
    if (input.renameOnConflict) {
      name = allocateUniqueName(name, existingNameSet())
    } else {
      throw createError({ statusCode: 409, statusMessage: `音源名称「${name}」已存在，请修改名称后重试` })
    }
  }

  await input.onPhase?.('configuring')
  const localPath = getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')
  await input.onPhase?.('checking')
  const probed = await probeLocalScript(localPath)
  const ts = nowIso()
  const enabled = input.enabled === false ? 0 : 1

  getDb()
    .prepare(
      `INSERT INTO sources (id, name, url, mirror_url, local_path, enabled, status, platforms, last_checked_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      url,
      localPath,
      enabled,
      probed.status,
      JSON.stringify(probed.platforms),
      ts,
      probed.lastError,
      ts,
      ts,
    )
  return getSource(id)!
}

/** 保存脚本（可同时改名）；覆盖本地文件并重载检测 */
export async function saveSourceScript(
  id: string,
  input: {
    script: string
    name?: string
    onPhase?: (status: 'loading' | 'configuring' | 'checking') => void | Promise<void>
  },
): Promise<SourceRow> {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  const script = String(input.script || '')
  if (!script || script.trim().length < 20) {
    throw createError({ statusCode: 400, statusMessage: '脚本内容过短' })
  }

  await input.onPhase?.('loading')

  let name = row.name
  if (input.name !== undefined) {
    name = cleanSourceName(input.name)
    if (!name || name === 'unnamed') {
      throw createError({ statusCode: 400, statusMessage: '名称无效' })
    }
    if (name !== row.name && findSourceByName(name)) {
      throw createError({ statusCode: 409, statusMessage: `音源名称「${name}」已存在，请修改名称后重试` })
    }
  }

  await input.onPhase?.('configuring')
  const localPath = row.local_path || getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')
  await input.onPhase?.('checking')
  const probed = await probeLocalScript(localPath)
  const ts = nowIso()
  getDb()
    .prepare(
      `UPDATE sources SET name=?, local_path=?, status=?, platforms=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`,
    )
    .run(
      name,
      localPath,
      probed.status,
      JSON.stringify(probed.platforms),
      ts,
      probed.lastError,
      ts,
      id,
    )
  return getSource(id)!
}

/**
 * 从远程 URL 重新拉取并覆盖本地脚本（编辑里「更新」）。
 * 调用前应由前端确认，避免冲掉手改 Key。
 */
export async function refreshSourceScriptFromUrl(id: string): Promise<SourceRow> {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  if (!isHttpUrl(row.url)) {
    throw createError({ statusCode: 400, statusMessage: '该音源没有可拉取的 http(s) URL' })
  }
  return await upsertSourceFromRemote({
    name: row.name,
    url: row.url,
    mirrorUrl: row.mirror_url || undefined,
  })
}

export type FileUploadConflict = {
  id: string
  name: string
  url: string
  existingId: string
  existingName: string
  reason: 'name'
}

type FileUploadItem = {
  name: string
  script: string
  conflict?: FileUploadConflict
}

function normalizeUploadFileName(raw: string) {
  return cleanSourceName(String(raw || '').replace(/\.js$/i, ''))
}

function buildFileUploadItems(files: Array<{ name: string; script: string }>): FileUploadItem[] {
  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: '未提供任何脚本文件' })
  }

  const items: FileUploadItem[] = []
  const batchFirst = new Map<string, { name: string }>()

  for (const file of files) {
    const name = normalizeUploadFileName(file.name)
    if (!name || name === 'unnamed') continue
    const script = String(file.script || '')
    if (script.trim().length < 20) continue

    let conflict: FileUploadConflict | undefined
    const existing = findSourceByName(name)
    if (existing) {
      conflict = {
        id: name,
        name,
        url: existing.url || '',
        existingId: existing.id,
        existingName: existing.name,
        reason: 'name',
      }
    } else {
      const first = batchFirst.get(name)
      if (first) {
        conflict = {
          id: name,
          name,
          url: '',
          existingId: '',
          existingName: first.name,
          reason: 'name',
        }
      } else {
        batchFirst.set(name, { name })
      }
    }

    items.push({ name, script, conflict })
  }

  if (!items.length) {
    throw createError({ statusCode: 400, statusMessage: '未找到可用的 .js 音源文件' })
  }
  return items
}

/** 批量上传预览：按文件名（去 .js）检测同名冲突 */
export function previewSourcesFromFiles(files: Array<{ name: string; script: string }>) {
  const items = buildFileUploadItems(files)
  const conflicts = items.filter((i) => i.conflict).map((i) => i.conflict!)
  return {
    dryRun: true,
    total: items.length,
    newCount: items.length - conflicts.length,
    conflictCount: conflicts.length,
    conflicts,
  }
}

/**
 * 批量上传：同名冲突按 overwrite / skip 处理（不再自动改名）。
 */
export async function applySourcesFromFiles(
  files: Array<{ name: string; script: string }>,
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
  const items = buildFileUploadItems(files)
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
        results.push({ ok: false, name: left.name, error: '整批超时' })
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
            error: `冲突已跳过（与「${item.conflict.existingName}」）`,
          })
          continue
        }

        await withTimeout(
          (async () => {
            const existing = item.conflict!.existingId
              ? getSource(item.conflict!.existingId)
              : findSourceByName(item.name)
            if (!existing) {
              const row = await addSourceFromScript({
                name: item.name,
                script: item.script,
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
              results.push({ ok: true, source: row })
              await reportProgress(opts?.onProgress, {
                index,
                total,
                name: item.name,
                status: 'done',
              })
              return
            }
            await saveSourceScript(existing.id, {
              script: item.script,
              name: item.name,
              onPhase: async (status) => {
                await reportProgress(opts?.onProgress, {
                  index,
                  total,
                  name: item.name,
                  status,
                })
              },
            })
            overwritten += 1
            results.push({ ok: true, overwritten: true, id: existing.id, name: item.name })
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
        continue
      }

      await withTimeout(
        (async () => {
          const row = await addSourceFromScript({
            name: item.name,
            script: item.script,
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
          results.push({ ok: true, source: row })
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
      results.push({ ok: false, name: item.name, error: message })
    }
  }

  return { total, imported, overwritten, skipped, failed, timedOut, results }
}

export function deleteSource(id: string) {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  if (row.local_path && existsSync(row.local_path)) {
    try {
      unlinkSync(row.local_path)
    } catch {
      /* ignore */
    }
  }
  getDb().prepare('DELETE FROM sources WHERE id=?').run(id)
  return { ok: true }
}

export async function checkSources(
  ids?: string[],
  opts?: { onProgress?: SourceProgressReporter },
) {
  const rows = ids?.length
    ? (ids.map((id) => getSource(id)).filter(Boolean) as SourceRow[])
    : listSources()
  const total = rows.length
  const deadline = createBatchDeadline(total)
  const out = []
  let timedOut = false

  for (let i = 0; i < rows.length; i++) {
    const index = i + 1
    const row = rows[i]!

    if (deadline.isExpired()) {
      timedOut = true
      for (let j = i; j < rows.length; j++) {
        const left = rows[j]!
        await reportProgress(opts?.onProgress, {
          index: j + 1,
          total,
          name: left.name,
          status: 'failed',
          error: '整批超时',
        })
        out.push({ id: left.id, status: 'dead', error: '整批超时' })
      }
      break
    }

    try {
      await withTimeout(
        (async () => {
          const ts = nowIso()
          const guard = acquireSourceRejectionGuard()
          try {
            if (!row.local_path || !existsSync(row.local_path)) {
              await reportProgress(opts?.onProgress, {
                index,
                total,
                name: row.name,
                status: 'loading',
              })
              await upsertSourceFromRemote({
                name: row.name,
                url: row.url,
                mirrorUrl: row.mirror_url || undefined,
              })
              const latest = getSource(row.id)
              out.push({
                id: row.id,
                status: latest?.status || 'unknown',
                error: latest?.last_error || undefined,
              })
            } else {
              await reportProgress(opts?.onProgress, {
                index,
                total,
                name: row.name,
                status: 'checking',
              })
              const handle = await loadLxSource(row.local_path, { bypassCache: true })
              const netErrs = await settleSourceNetworkErrors(guard)
              if (netErrs.length) {
                const msg = `更新检测失败: ${netErrs[0]!.message}`
                getDb()
                  .prepare(
                    `UPDATE sources SET status=?, platforms=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`,
                  )
                  .run('dead', JSON.stringify(handle.platforms), ts, msg, ts, row.id)
                out.push({ id: row.id, status: 'dead', error: msg })
              } else {
                getDb()
                  .prepare(
                    `UPDATE sources SET status=?, platforms=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`,
                  )
                  .run('ok', JSON.stringify(handle.platforms), ts, null, ts, row.id)
                out.push({ id: row.id, status: 'ok' })
              }
            }
            await reportProgress(opts?.onProgress, {
              index,
              total,
              name: row.name,
              status: 'done',
            })
          } finally {
            guard.release()
          }
        })(),
        SOURCE_ITEM_TIMEOUT_MS,
        `音源「${row.name}」`,
      )
    } catch (err: any) {
      const ts = nowIso()
      const message = err?.message || String(err)
      getDb()
        .prepare(`UPDATE sources SET status=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`)
        .run('dead', ts, message, ts, row.id)
      await reportProgress(opts?.onProgress, {
        index,
        total,
        name: row.name,
        status: 'failed',
        error: message,
      })
      out.push({ id: row.id, status: 'dead', error: message })
    }
  }

  return { items: out, timedOut, total }
}

export async function cleanupDeadSources(
  dryRun = false,
  opts?: { onProgress?: SourceProgressReporter },
) {
  const dead = getDb().prepare(`SELECT * FROM sources WHERE status = 'dead'`).all() as SourceRow[]
  if (dryRun) return { dryRun: true, count: dead.length, items: dead, deleted: 0, timedOut: false }

  const total = dead.length
  const deadline = createBatchDeadline(total)
  const deletedItems: SourceRow[] = []
  let timedOut = false

  for (let i = 0; i < dead.length; i++) {
    const index = i + 1
    const row = dead[i]!

    if (deadline.isExpired()) {
      timedOut = true
      for (let j = i; j < dead.length; j++) {
        const left = dead[j]!
        await reportProgress(opts?.onProgress, {
          index: j + 1,
          total,
          name: left.name,
          status: 'failed',
          error: '整批超时',
        })
      }
      break
    }

    try {
      await withTimeout(
        (async () => {
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: row.name,
            status: 'loading',
          })
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: row.name,
            status: 'configuring',
          })
          deleteSource(row.id)
          deletedItems.push(row)
          await reportProgress(opts?.onProgress, {
            index,
            total,
            name: row.name,
            status: 'done',
          })
        })(),
        SOURCE_ITEM_TIMEOUT_MS,
        `音源「${row.name}」`,
      )
    } catch (err: any) {
      await reportProgress(opts?.onProgress, {
        index,
        total,
        name: row.name,
        status: 'failed',
        error: err?.message || String(err),
      })
    }
  }

  return {
    dryRun: false,
    count: deletedItems.length,
    deleted: deletedItems.length,
    items: deletedItems,
    timedOut,
    total,
  }
}

export function listEnabledOkSources(platform?: string) {
  const rows = listSources().filter((s) => s.enabled === 1 && s.status === 'ok')
  if (!platform) return rows
  return rows.filter((s) => {
    try {
      const platforms = JSON.parse(s.platforms) as string[]
      return platforms.includes(platform)
    } catch {
      return false
    }
  })
}
