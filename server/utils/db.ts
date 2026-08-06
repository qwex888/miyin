import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

export function openDb(dataDir?: string) {
  const path = getDbPath(dataDir)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return db
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
