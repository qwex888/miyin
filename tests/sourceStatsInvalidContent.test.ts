import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { recordSourceOutcome, sourceScores } from '../server/services/sourceStats'

describe('source_stats：invalid_contents 计数与老库迁移', () => {
  let prevDataDir: string | undefined
  let dataDir: string

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    dataDir = mkdtempSync(join(tmpdir(), 'miyin-stat-'))
    process.env.DATA_DIR = dataDir
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir) process.env.DATA_DIR = prevDataDir
    else delete process.env.DATA_DIR
  })

  it('新库带 invalid_contents 列，且能记录坏内容', () => {
    const db = getDb()
    const cols = db.prepare(`PRAGMA table_info(source_stats)`).all().map((c: any) => c.name)
    expect(cols).toContain('invalid_contents')

    recordSourceOutcome({ sourceId: 'html', platform: 'tx', outcome: 'invalid-content' })
    const row = db
      .prepare(`SELECT attempts, invalid_contents FROM source_stats WHERE source_id='html'`)
      .get() as { attempts: number; invalid_contents: number }
    expect(row.attempts).toBe(1)
    expect(row.invalid_contents).toBe(1)
  })

  it('老库（无该列）平滑升级：加列后旧数据不丢', () => {
    // 造一个「升级前」的库：source_stats 没有 invalid_contents 列
    const legacy = new Database(join(dataDir, 'miyin.sqlite'))
    legacy.exec(`CREATE TABLE source_stats (
      source_id TEXT NOT NULL, platform TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
      previews INTEGER NOT NULL DEFAULT 0, quality_lies INTEGER NOT NULL DEFAULT 0,
      kbps_sum REAL NOT NULL DEFAULT 0, kbps_count INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT, PRIMARY KEY (source_id, platform));`)
    legacy.exec(`INSERT INTO source_stats (source_id, platform, attempts) VALUES ('legacy','tx',3);`)
    legacy.close()

    // 走真实路径：getDb() 会执行 migrateSchema
    const db = getDb()
    const cols = db.prepare(`PRAGMA table_info(source_stats)`).all().map((c: any) => c.name)
    expect(cols).toContain('invalid_contents')
    const row = db.prepare(`SELECT * FROM source_stats WHERE source_id='legacy'`).get() as any
    expect(row.attempts).toBe(3)
    expect(row.invalid_contents).toBe(0)
  })

  it('返回非音频内容的音源被压到最低（比谎报档位还低）', () => {
    recordSourceOutcome({ sourceId: 'html', platform: 'tx', outcome: 'invalid-content' })
    recordSourceOutcome({ sourceId: 'liar', platform: 'tx', outcome: 'quality-lie' })
    recordSourceOutcome({ sourceId: 'ok', platform: 'tx', outcome: 'success', kbps: 2372 })

    const scores = sourceScores('tx')
    expect(scores.get('html')!).toBeLessThan(scores.get('liar')!)
    expect(scores.get('liar')!).toBeLessThan(scores.get('ok')!)
  })
})
