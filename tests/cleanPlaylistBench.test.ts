import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { parsePlaylist } from '../server/services/playlistService'
import { enqueueDownload, batchEnqueueDownload } from '../server/services/downloadQueue'

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

function forceGc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

function getMemMb() {
  forceGc()
  const m = process.memoryUsage()
  return {
    rss: Math.round((m.rss / 1024 / 1024) * 100) / 100,
    heapUsed: Math.round((m.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotal: Math.round((m.heapTotal / 1024 / 1024) * 100) / 100,
    external: Math.round((m.external / 1024 / 1024) * 100) / 100,
    arrayBuffers: Math.round(((m.arrayBuffers || 0) / 1024 / 1024) * 100) / 100,
  }
}

describe.skipIf(!process.env.RUN_BENCHMARKS)('Clean Baseline Playlist Parse & Import Benchmark', () => {
  it('measures exact parse and import metrics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-bench-pr1-'))
    closeDb()
    process.env.DATA_DIR = dir
    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('bench-src', '测试音源', 'http://example.com/s.js', '/tmp/fake.js', JSON.stringify(['wy']))

    // 0. 初始基线
    const mem0 = getMemMb()

    // 1. 构建/解析歌单（若无外部环境变量则使用离线 600 首规模数据集，杜绝外部不稳定依赖）
    const t0 = performance.now()
    let draft: { title: string; url: string; tracks: Array<any> }
    if (process.env.BENCH_PLAYLIST_URL) {
      draft = await parsePlaylist(process.env.BENCH_PLAYLIST_URL)
    } else {
      const syntheticTracks = []
      for (let i = 1; i <= 600; i++) {
        syntheticTracks.push({
          externalId: `synthetic_${i}`,
          title: `压测歌曲_${i}`,
          artist: `歌手_${i % 10}`,
          album: `专辑_${i % 20}`,
          duration: 240,
          platform: 'wy',
        })
      }
      draft = {
        title: '离线基准测试歌单',
        url: 'https://music.local/playlist/bench-600',
        tracks: syntheticTracks,
      }
    }
    const t1 = performance.now()
    const mem1 = getMemMb()

    // 2. 批量入库（使用分批事务 batchEnqueueDownload）
    const t2 = performance.now()
    const toEnqueue = draft.tracks.map((track) => ({
      title: track.title,
      artist: track.artist,
      album: track.album,
      platform: track.platform,
      musicInfo: track.musicInfo || {
        name: track.title,
        singer: track.artist,
        songmid: track.externalId,
        source: track.platform,
      },
      externalId: track.externalId,
      playlistUrl: draft.url,
    }))
    const { enqueued } = batchEnqueueDownload(toEnqueue, { silent: true })
    const t3 = performance.now()
    const mem2 = getMemMb()
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 100)
    await promise
    forceGc()
    const mem3 = getMemMb()

    console.log('BENCHMARK_RESULT:' + JSON.stringify({
      title: draft.title,
      trackCount: draft.tracks.length,
      parseMs: Math.round(t1 - t0),
      importMs: Math.round(t3 - t2),
      mem0,
      mem1,
      mem2,
      mem3,
    }))

    expect(enqueued).toBe(draft.tracks.length)
    expect(mem3.heapUsed - mem0.heapUsed).toBeLessThan(15)
  }, 40000)
})
