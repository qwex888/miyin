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

describe.skipIf(!process.env.RUN_BENCHMARKS)('Real Playlist Parse & Import Memory Verification', () => {
  it('parses real Netease playlist and imports tasks with bounded memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-playlist-bench-'))
    closeDb()
    process.env.DATA_DIR = dir
    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('bench-src', '测试音源', 'http://example.com/s.js', '/tmp/fake.js', JSON.stringify(['wy']))

    // 0. 初始基准
    const mem0 = getMemMb()
    console.log(`\n================== 歌单解析与导入内存压测 ==================`)
    console.log(`【0. 初始基线内存】 RSS: ${mem0.rss} MB | HeapUsed: ${mem0.heapUsed} MB | HeapTotal: ${mem0.heapTotal} MB`)

    // 1. 获取/构建歌单数据（默认离线 600 首结构化数据，杜绝外部网络与链接失效隐患）
    const tParseStart = Date.now()
    let draft: { title: string; platform: string; id: string; url: string; tracks: Array<any> }
    if (process.env.BENCH_PLAYLIST_URL) {
      const parsed = await parsePlaylist(process.env.BENCH_PLAYLIST_URL)
      draft = { ...parsed, id: 'remote' }
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
        platform: 'wy',
        id: 'synthetic-600',
        url: 'https://music.local/playlist/synthetic-600',
        tracks: syntheticTracks,
      }
    }
    const tParseEnd = Date.now()

    const memAfterParse = getMemMb()
    console.log(`\n【1. 歌单解析完成】`)
    console.log(`  - 歌单名称: 「${draft.title}」`)
    console.log(`  - 平台识别: ${draft.platform} | 歌单 ID: ${draft.id}`)
    console.log(`  - 曲目总数: ${draft.tracks.length} 首`)
    console.log(`  - 解析耗时: ${tParseEnd - tParseStart} ms`)
    console.log(`  - 解析后内存: RSS: ${memAfterParse.rss} MB | HeapUsed: ${memAfterParse.heapUsed} MB (增长: +${Math.round((memAfterParse.heapUsed - mem0.heapUsed) * 100) / 100} MB)`)

    expect(draft.tracks.length).toBeGreaterThan(0)

    // 2. 批量入库导入（创建下载任务记录，纯入队不执行下载）
    const tImportStart = Date.now()
    const toEnqueue = draft.tracks.map((track) => ({
      title: track.title,
      artist: track.artist,
      album: track.album,
      platform: track.platform,
      musicInfo: {
        name: track.title,
        singer: track.artist,
        songmid: track.externalId,
        source: track.platform,
      },
      externalId: track.externalId,
      playlistUrl: draft.url,
    }))
    const { enqueued } = batchEnqueueDownload(toEnqueue, { silent: true })
    const tImportEnd = Date.now()

    const memAfterImport = getMemMb()
    console.log(`\n【2. 批量导入入队完成】`)
    console.log(`  - 成功入队条数: ${enqueued} 条`)
    console.log(`  - 入库耗时: ${tImportEnd - tImportStart} ms`)
    console.log(`  - 入库后内存: RSS: ${memAfterImport.rss} MB | HeapUsed: ${memAfterImport.heapUsed} MB (相比初始净增: +${Math.round((memAfterImport.heapUsed - mem0.heapUsed) * 100) / 100} MB)`)

    expect(enqueued).toBe(draft.tracks.length)

    // 3. 批次清理与垃圾回收收敛验证
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 100)
    await promise
    forceGc()
    const memFinal = getMemMb()
    const netGrowth = Math.round((memFinal.heapUsed - mem0.heapUsed) * 100) / 100

    console.log(`\n【3. 批次结束与 GC 收敛】`)
    console.log(`  - 最终常驻内存: RSS: ${memFinal.rss} MB | HeapUsed: ${memFinal.heapUsed} MB | HeapTotal: ${memFinal.heapTotal} MB`)
    console.log(`  - 全程常驻堆内存净增长: ${netGrowth} MB\n`)

    // 断言：在没有内存泄漏的情况下，导入批次结束后经 GC，常驻堆内存净增长必须控制在 15MB 以内
    expect(netGrowth).toBeLessThan(15)
  }, 40000)
})
