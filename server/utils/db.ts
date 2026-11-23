import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildDedupKey, buildSearchText } from '#shared/trackKey'
import { getDbPath } from './paths'

let dbInstance: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mirror_url TEXT,
  local_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  platforms TEXT NOT NULL DEFAULT '[]',
  last_checked_at TEXT,
  last_error TEXT,
  update_info_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  platform TEXT NOT NULL,
  source_id TEXT,
  quality TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  file_path TEXT,
  lyric_path TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  match_method TEXT,
  match_score REAL,
  batch_id TEXT,
  playlist_url TEXT,
  music_info_json TEXT,
  file_size INTEGER,
  dedup_key TEXT,
  search_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_download_tasks_playlist_url ON download_tasks(playlist_url);
CREATE INDEX IF NOT EXISTS idx_download_tasks_batch_id ON download_tasks(batch_id);
`

export function openDb(dataDir?: string) {
  const path = getDbPath(dataDir)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -2000')
  db.pragma('wal_autocheckpoint = 100')
  db.pragma('mmap_size = 0')
  db.exec(SCHEMA)
  migrateSchema(db)
  return db
}

function migrateSchema(db: Database.Database) {
  const taskCols = db.prepare(`PRAGMA table_info(download_tasks)`).all() as Array<{ name: string }>
  const taskNames = new Set(taskCols.map((c) => c.name))
  if (!taskNames.has('file_size')) {
    db.exec(`ALTER TABLE download_tasks ADD COLUMN file_size INTEGER`)
  }

  const sourceCols = db.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>
  const sourceNames = new Set(sourceCols.map((c) => c.name))
  if (!sourceNames.has('update_info_json')) {
    db.exec(`ALTER TABLE sources ADD COLUMN update_info_json TEXT`)
  }

  // 曲库检索能力层：判重键与检索文本（老库平滑升级，null 安全）
  if (!taskNames.has('dedup_key')) {
    db.exec(`ALTER TABLE download_tasks ADD COLUMN dedup_key TEXT`)
  }
  if (!taskNames.has('search_text')) {
    db.exec(`ALTER TABLE download_tasks ADD COLUMN search_text TEXT`)
  }

  db.exec(`
CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_download_tasks_playlist_url ON download_tasks(playlist_url);
CREATE INDEX IF NOT EXISTS idx_download_tasks_batch_id ON download_tasks(batch_id);
CREATE INDEX IF NOT EXISTS idx_download_tasks_dedup_key ON download_tasks(dedup_key);

-- 音源实测表现统计：用于"先探哪个音源"的排序（按 source_id + platform 聚合）
CREATE TABLE IF NOT EXISTS source_stats (
  source_id      TEXT NOT NULL,
  platform       TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  successes      INTEGER NOT NULL DEFAULT 0,
  previews       INTEGER NOT NULL DEFAULT 0,
  quality_lies   INTEGER NOT NULL DEFAULT 0,
  invalid_contents INTEGER NOT NULL DEFAULT 0,
  kbps_sum       REAL NOT NULL DEFAULT 0,
  kbps_count     INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  PRIMARY KEY (source_id, platform)
);
`)

  // 音源「返回非音频内容」（HTML 落地页 / 残缺文件）计数：老库平滑升级
  const statCols = db.prepare(`PRAGMA table_info(source_stats)`).all() as Array<{ name: string }>
  if (!statCols.some((c) => c.name === 'invalid_contents')) {
    db.exec(`ALTER TABLE source_stats ADD COLUMN invalid_contents INTEGER NOT NULL DEFAULT 0`)
  }

  migrateDedupKeyVersion(db)
}

/**
 * 判重键的归一化口径版本。
 *
 * - v1（初版）：`dedup_key` **去除**括号内容 → `稻香 (Live)` ≡ `稻香`
 * - v2（2026-10-09）：**保留**括号内容 → 允许同一首歌的多个版本共存
 *
 * 口径变更后旧键语义失效，必须整体置空重算 —— 否则 `稻香 (Demo)` 会继续被判为「已存在」。
 * `search_text` 规则未变，无需重算。
 */
const DEDUP_KEY_VERSION = 2

function migrateDedupKeyVersion(db: Database.Database) {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= DEDUP_KEY_VERSION) return
  // 置空后由 backfillTrackKeys() 按新口径重算；期间判重会退化为「不命中」（放行），比误判重安全
  db.exec(`UPDATE download_tasks SET dedup_key = NULL`)
  db.pragma(`user_version = ${DEDUP_KEY_VERSION}`)
}

/** 单批回填条数：控制单事务锁占用与 WAL 峰值（与批量入队的分块策略一致） */
const BACKFILL_CHUNK_SIZE = 200

/**
 * 分批回填 `dedup_key` / `search_text`（仅处理 `dedup_key IS NULL` 的行）。
 *
 * - 可中断可续：已回填的行不会再被选中
 * - 已全部回填时是一次空查询，可直接在启动期调用
 * - 返回本次回填的总行数
 */
export function backfillTrackKeys(opts?: { chunkSize?: number; maxRows?: number }): number {
  const db = getDb()
  const chunkSize = opts?.chunkSize ?? BACKFILL_CHUNK_SIZE
  const maxRows = opts?.maxRows ?? Number.POSITIVE_INFINITY

  const selectStmt = db.prepare(
    `SELECT id, title, artist, album FROM download_tasks
     WHERE dedup_key IS NULL
     LIMIT ?`,
  )
  const updateStmt = db.prepare(
    `UPDATE download_tasks SET dedup_key = ?, search_text = ? WHERE id = ?`,
  )

  let filled = 0
  // 每轮至少推进一行，避免任何意外情况下死循环
  for (let guard = 0; guard < 1_000_000; guard++) {
    const remaining = maxRows - filled
    if (remaining <= 0) break
    const limit = Math.min(chunkSize, remaining)
    const rows = selectStmt.all(limit) as Array<{
      id: string
      title: string
      artist: string
      album: string | null
    }>
    if (!rows.length) break

    db.transaction((list: typeof rows) => {
      for (const row of list) {
        updateStmt.run(
          buildDedupKey(row.artist, row.title),
          buildSearchText({ title: row.title, artist: row.artist, album: row.album }),
          row.id,
        )
      }
    })(rows)

    filled += rows.length
    if (rows.length < limit) break
  }
  return filled
}

/**
 * 后台渐进回填：每批之间让出事件循环（`setImmediate`），
 * 避免大库（10w+ 行）启动期长事务阻塞请求处理。
 * 返回回填总行数；已全部回填时立即返回 0。
 */
export async function backfillTrackKeysInBackground(opts?: {
  chunkSize?: number
}): Promise<number> {
  const chunkSize = opts?.chunkSize ?? BACKFILL_CHUNK_SIZE
  let total = 0
  for (let guard = 0; guard < 1_000_000; guard++) {
    const filled = backfillTrackKeys({ chunkSize, maxRows: chunkSize })
    total += filled
    if (filled < chunkSize) break
    await new Promise((resolve) => setImmediate(resolve))
  }
  return total
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = openDb()
  }
  return dbInstance
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

export function checkpointAndShrinkDb() {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(TRUNCATE)')
      dbInstance.pragma('shrink_memory')
    } catch {
      /* ignore */
    }
  }
}
