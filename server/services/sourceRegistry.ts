import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { getDb } from '../utils/db'
import { getSourceCachePath } from '../utils/paths'
import { parseSourceText } from './sourceImport'
import { loadLxSource } from './sourceRuntime'

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

export function listSources(): SourceRow[] {
  return getDb().prepare('SELECT * FROM sources ORDER BY created_at DESC').all() as SourceRow[]
}

export function getSource(id: string): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
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

export async function upsertSourceFromRemote(input: { name: string; url: string; mirrorUrl?: string }) {
  const id = idFromUrl(input.url)
  const script = await fetchSourceScript(input.mirrorUrl || input.url)
  const localPath = getSourceCachePath(id)
  writeFileSync(localPath, script, 'utf8')

  let platforms: string[] = []
  let status = 'unknown'
  let lastError: string | null = null
  try {
    const handle = loadLxSource(localPath)
    platforms = handle.platforms
    status = 'ok'
  } catch (err: any) {
    status = 'dead'
    lastError = err?.message || String(err)
  }

  const ts = nowIso()
  const existing = getSource(id)
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

export async function importSourcesText(text: string) {
  const parsed = parseSourceText(text)
  if (!parsed.length) {
    throw createError({ statusCode: 400, statusMessage: '未解析到任何音源 URL' })
  }
  const results = []
  for (const item of parsed) {
    try {
      const row = await upsertSourceFromRemote(item)
      results.push({ ok: true, source: row })
    } catch (err: any) {
      results.push({ ok: false, name: item.name, url: item.url, error: err?.message || String(err) })
    }
  }
  return { total: parsed.length, results }
}

export function updateSource(id: string, patch: { enabled?: boolean }) {
  const row = getSource(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: '音源不存在' })
  const enabled = patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0
  getDb()
    .prepare('UPDATE sources SET enabled=?, updated_at=? WHERE id=?')
    .run(enabled, nowIso(), id)
  return getSource(id)!
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
    try {
      if (!row.local_path || !existsSync(row.local_path)) {
        await upsertSourceFromRemote({ name: row.name, url: row.url, mirrorUrl: row.mirror_url || undefined })
      } else {
        const handle = loadLxSource(row.local_path)
        getDb()
          .prepare(
            `UPDATE sources SET status=?, platforms=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`,
          )
          .run('ok', JSON.stringify(handle.platforms), ts, null, ts, row.id)
      }
      out.push({ id: row.id, status: 'ok' })
    } catch (err: any) {
      getDb()
        .prepare(`UPDATE sources SET status=?, last_checked_at=?, last_error=?, updated_at=? WHERE id=?`)
        .run('dead', ts, err?.message || String(err), ts, row.id)
      out.push({ id: row.id, status: 'dead', error: err?.message || String(err) })
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

// silence unused import if any
void randomUUID
