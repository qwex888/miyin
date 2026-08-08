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
}): Promise<SourceRow> {
  const id = idFromUrl(input.url)
  const existing = getSource(id)
  if (existing && !input.allowUpdate) {
    throw createError({ statusCode: 409, statusMessage: '该音源 URL 已存在' })
  }

  const script = await fetchSourceScript(input.mirrorUrl || input.url)
  const localPath = getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')

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
export async function importSourcesText(text: string) {
  const parsed = parseSourceText(text)
  if (!parsed.length) {
    throw createError({ statusCode: 400, statusMessage: '未解析到任何音源 URL' })
  }

  const takenNames = existingNameSet()
  const seenUrls = new Set(listSources().map((s) => s.url))
  const results: Array<Record<string, any>> = []
  let skipped = 0
  let renamed = 0

  for (const item of parsed) {
    if (seenUrls.has(item.url)) {
      skipped += 1
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
      const row = await persistSource({
        name: finalName,
        url: item.url,
        allowUpdate: false,
      })
      seenUrls.add(item.url)
      takenNames.add(finalName)
      results.push({
        ok: true,
        source: row,
        renamed: finalName !== item.name ? finalName : undefined,
      })
    } catch (err: any) {
      results.push({ ok: false, name: item.name, url: item.url, error: err?.message || String(err) })
    }
  }

  return {
    total: parsed.length,
    imported: results.filter((r) => r.ok).length,
    skipped,
    renamed,
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
}) {
  const name = cleanSourceName(input.name)
  const script = String(input.script || '')
  if (!name || name === 'unnamed') {
    throw createError({ statusCode: 400, statusMessage: '名称必填' })
  }
  if (!script || script.trim().length < 20) {
    throw createError({ statusCode: 400, statusMessage: '脚本内容过短' })
  }

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
    throw createError({ statusCode: 409, statusMessage: `音源名称「${name}」已存在，请修改名称后重试` })
  }

  const localPath = getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')
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
  input: { script: string; name?: string },
): Promise<SourceRow> {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  const script = String(input.script || '')
  if (!script || script.trim().length < 20) {
    throw createError({ statusCode: 400, statusMessage: '脚本内容过短' })
  }

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

  const localPath = row.local_path || getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')
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

/**
 * 批量上传多个脚本文件。返回逐条结果。
 */
export async function addSourcesFromFiles(
  files: Array<{ name: string; script: string }>,
): Promise<{
  total: number
  imported: number
  renamed: number
  results: Array<Record<string, any>>
}> {
  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: '未提供任何脚本文件' })
  }
  const takenNames = existingNameSet()
  const results: Array<Record<string, any>> = []
  let renamed = 0

  for (const file of files) {
    const base = cleanSourceName(file.name.replace(/\.js$/i, ''))
    const finalName = allocateUniqueName(base, takenNames)
    if (finalName !== base) renamed += 1
    try {
      const row = await addSourceFromScript({ name: finalName, script: file.script })
      takenNames.add(finalName)
      results.push({
        ok: true,
        source: row,
        renamed: finalName !== base ? finalName : undefined,
      })
    } catch (err: any) {
      results.push({ ok: false, name: base, error: err?.message || String(err) })
    }
  }

  return {
    total: files.length,
    imported: results.filter((r) => r.ok).length,
    renamed,
    results,
  }
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

export async function checkSources(ids?: string[]) {
  const rows = ids?.length
    ? (ids.map((id) => getSource(id)).filter(Boolean) as SourceRow[])
    : listSources()
  const out = []
  for (const row of rows) {
    const ts = nowIso()
    const guard = acquireSourceRejectionGuard()
    try {
      if (!row.local_path || !existsSync(row.local_path)) {
        await upsertSourceFromRemote({ name: row.name, url: row.url, mirrorUrl: row.mirror_url || undefined })
        // upsert 已写入 status；再读一次供返回
        const latest = getSource(row.id)
        out.push({ id: row.id, status: latest?.status || 'unknown', error: latest?.last_error || undefined })
      } else {
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
    } catch (err: any) {
      getDb()
        .prepare(`UPDATE sources SET status=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`)
        .run('dead', ts, err?.message || String(err), ts, row.id)
      out.push({ id: row.id, status: 'dead', error: err?.message || String(err) })
    } finally {
      guard.release()
    }
  }
  return out
}

export function cleanupDeadSources(dryRun = false) {
  const dead = getDb().prepare(`SELECT * FROM sources WHERE status = 'dead'`).all() as SourceRow[]
  if (dryRun) return { dryRun: true, count: dead.length, items: dead }
  for (const row of dead) deleteSource(row.id)
  return { dryRun: false, count: dead.length, items: dead }
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
