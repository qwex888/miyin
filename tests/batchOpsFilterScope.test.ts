import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTasks, batchCancelTasks, batchRetryTasks } from '../server/services/downloadQueue'
import { closeDb, getDb } from '../server/utils/db'
import { parseTaskFilter } from '../server/utils/taskFilter'

declare global {
  var createError: (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => Error
}

globalThis.createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) => {
  const err = new Error(input.statusMessage || 'Error') as Error & {
    statusCode?: number
    data?: unknown
  }
  err.statusCode = input.statusCode
  err.data = input.data
  return err
}

/**
 * 批量操作的筛选作用域。
 *
 * 背景：`allWithTab` 的全选语义原本是「整个分类」，筛选条件只影响前端列表，
 * 于是「按音质筛选后全选 → 批量取消/重试」会连筛选外的任务一起操作。
 * 这里锁死「带 filter 时只作用于筛选结果」，并验证不带 filter 时行为不变。
 */
describe('批量操作按筛选条件限定作用域', () => {
  let tmpDir: string

  function seedTask(row: {
    id: string
    status: string
    platform?: string
    quality?: string
    title?: string
    createdAt?: string
  }) {
    const now = row.createdAt || '2026-11-01T00:00:00.000Z'
    getDb()
      .prepare(
        `INSERT INTO download_tasks (id, title, artist, platform, quality, status, search_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title || row.id,
        'Artist',
        row.platform || 'wy',
        row.quality || '320k',
        row.status,
        row.title || row.id,
        now,
        now,
      )
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'miyin-batch-filter-'))
    process.env.DATA_DIR = tmpDir
    process.env.DOWNLOAD_DIR = tmpDir
    closeDb()
  })

  afterEach(() => {
    closeDb()
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('取消：带音质筛选时只取消筛选内的运行中任务', () => {
    seedTask({ id: 'run-128', status: 'running', quality: '128k' })
    seedTask({ id: 'run-320', status: 'running', quality: '320k' })
    seedTask({ id: 'run-128b', status: 'running', quality: '128k' })

    const res = batchCancelTasks(undefined, { tab: 'running', filter: { quality: '128k' } })
    expect(res.count).toBe(2)

    const remaining = listTasks({ tab: 'running' })
    expect(remaining.map((t) => t.id)).toEqual(['run-320'])
  })

  it('取消：不带筛选时保持原行为（整个分类）', () => {
    seedTask({ id: 'run-1', status: 'running', quality: '128k' })
    seedTask({ id: 'run-2', status: 'running', quality: '320k' })
    seedTask({ id: 'queued-1', status: 'queued', quality: 'flac' })

    const res = batchCancelTasks(undefined, { tab: 'running' })
    expect(res.count).toBe(3)
    expect(listTasks({ tab: 'running' })).toHaveLength(0)
  })

  it('重试：带平台筛选时只重试该平台', () => {
    seedTask({ id: 'f-wy', status: 'failed', platform: 'wy' })
    seedTask({ id: 'f-tx', status: 'failed', platform: 'tx' })
    seedTask({ id: 'f-tx2', status: 'failed', platform: 'tx' })

    const res = batchRetryTasks(undefined, { tab: 'failed', filter: { platform: 'tx' } })
    expect(res.count).toBe(2)
    // 未命中的 wy 任务仍是 failed
    expect(listTasks({ tab: 'failed' }).map((t) => t.id)).toEqual(['f-wy'])
  })

  it('重试：关键词与日期区间同时生效', () => {
    seedTask({ id: 'old-hit', status: 'failed', title: '渡口 live', createdAt: '2026-10-01T00:00:00.000Z' })
    seedTask({ id: 'new-hit', status: 'failed', title: '渡口 现场', createdAt: '2026-11-03T00:00:00.000Z' })
    seedTask({ id: 'new-miss', status: 'failed', title: '稻香', createdAt: '2026-11-03T00:00:00.000Z' })

    const res = batchRetryTasks(undefined, {
      tab: 'failed',
      filter: { q: '渡口', since: '2026-11-01', until: '2026-11-30' },
    })
    expect(res.count).toBe(1)
    expect(listTasks({ tab: 'failed' }).map((t) => t.id).sort()).toEqual(['new-miss', 'old-hit'])
  })

  it('显式传入 ids 时，filter 不参与（以 ids 为准）', () => {
    seedTask({ id: 'a', status: 'running', quality: '128k' })
    seedTask({ id: 'b', status: 'running', quality: '320k' })

    const res = batchCancelTasks(['b'], { tab: 'running', filter: { quality: '128k' } })
    expect(res.count).toBe(1)
    expect(listTasks({ tab: 'running' }).map((t) => t.id)).toEqual(['a'])
  })
})

describe('parseTaskFilter 对非法入参 fail-closed', () => {
  it('未传时返回空条件', () => {
    expect(parseTaskFilter(undefined)).toEqual({})
    expect(parseTaskFilter(null)).toEqual({})
    expect(parseTaskFilter({})).toEqual({})
  })

  it('正常字段被正确映射', () => {
    expect(
      parseTaskFilter({
        playlist_url: 'http://x/p',
        batch_id: 'b1',
        q: ' 稻香 ',
        platform: 'wy',
        quality: '128k',
        since: '2026-11-01',
        until: '2026-11-30',
      }),
    ).toEqual({
      playlistUrl: 'http://x/p',
      batchId: 'b1',
      q: '稻香',
      platform: 'wy',
      quality: '128k',
      since: '2026-11-01',
      until: '2026-11-30',
    })
  })

  it('空串等同未设置（与列表接口一致）', () => {
    expect(parseTaskFilter({ quality: '   ', platform: '' })).toEqual({})
  })

  it('非字符串值必须报错，不能静默丢条件', () => {
    expect(() => parseTaskFilter({ quality: 320 })).toThrow()
    expect(() => parseTaskFilter({ platform: ['wy'] })).toThrow()
  })

  it('未知字段必须报错（拼错字段名 = 条件消失）', () => {
    expect(() => parseTaskFilter({ quality_filter: '128k' })).toThrow()
  })

  it('非对象必须报错', () => {
    expect(() => parseTaskFilter([])).toThrow()
    expect(() => parseTaskFilter('128k')).toThrow()
  })

  it('非法日期必须报错（否则会被归一化成错误的区间）', () => {
    expect(() => parseTaskFilter({ until: '2026-02-31' })).toThrow()
    expect(() => parseTaskFilter({ since: '2026/11/01' })).toThrow()
    expect(() => parseTaskFilter({ since: '2026-13-01' })).toThrow()
  })
})
