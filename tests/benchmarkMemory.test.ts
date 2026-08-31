import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import {
  loadLxSource,
  resetSourceRuntimeState,
} from '../server/services/sourceRuntime'
import {
  batchEnqueueDownload,
  downloadEvents,
  listTasks,
} from '../server/services/downloadQueue'

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
  }
}

describe('PR1 Performance & Memory Leak Verification Benchmark', () => {
  it('verifies bounded heap memory after 300 sandboxed script loads and 500 queued task updates', async () => {
    const mem0 = getMemMb()
    console.log(`\n[Benchmark 起始基准] RSS: ${mem0.rss} MB | HeapUsed: ${mem0.heapUsed} MB | HeapTotal: ${mem0.heapTotal} MB`)

    // 1. 模拟大量音源加载与带有未捕获异步网络 Promise 的场景
    const dir = mkdtempSync(join(tmpdir(), 'miyin-bench-'))
    const scriptPath = join(dir, 'bench-source.js')
    writeFileSync(
      scriptPath,
      `
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, async () => 'http://127.0.0.1:9999/dummy.mp3')
      send(EVENT_NAMES.inited, { sources: { wy: { qualitys: ['128k', '320k'] } } })
      `,
      'utf8',
    )

    const t0 = Date.now()
    for (let i = 0; i < 300; i++) {
      const handle = await loadLxSource(scriptPath, { bypassCache: true })
      handle.dispose()
    }
    const t1 = Date.now()
    const memAfterSources = getMemMb()
    console.log(`[阶段 1: 音源沙箱] 300 次 VM 沙箱加载耗时: ${t1 - t0}ms | HeapUsed: ${memAfterSources.heapUsed} MB (增长: +${Math.round((memAfterSources.heapUsed - mem0.heapUsed) * 100) / 100} MB)`)
    // 2. 模拟 500 个任务高频入队和事件触发
    closeDb()
    process.env.DATA_DIR = dir
    const db = getDb()
    db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    ).run('bench-src', '压测音源', 'http://example.com/s.js', scriptPath, JSON.stringify(['wy']))

    let broadcastCount = 0
    const onTask = () => {
      broadcastCount++
    }
    downloadEvents.on('task', onTask)

    const t2 = Date.now()
    const items = []
    for (let i = 0; i < 500; i++) {
      items.push({
        title: `压测曲目_${i}`,
        artist: '压测歌手',
        album: '压测专辑',
        platform: 'wy',
        musicInfo: { songmid: `mid_${i}` },
      })
    }
    batchEnqueueDownload(items, { silent: true })
    const t3 = Date.now()
    const memAfterQueue = getMemMb()
    console.log(`[阶段 2: 任务队列] 500 个任务批量入队耗时: ${t3 - t2}ms | HeapUsed: ${memAfterQueue.heapUsed} MB`)

    // 3. 终态垃圾回收验证
    resetSourceRuntimeState()
    closeDb()
    forceGc()
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 100)
    await promise
    forceGc()

    const memFinal = getMemMb()
    const heapDiff = Math.round((memFinal.heapUsed - mem0.heapUsed) * 100) / 100
    console.log(`[阶段 3: 批次收敛] 最终收敛内存: RSS: ${memFinal.rss} MB | HeapUsed: ${memFinal.heapUsed} MB | 全程净堆增量: ${heapDiff} MB\n`)

    // 断言：在执行 300 次完整沙箱执行与 500 次任务写入后，最终常驻堆内存净增长必须控制在 50MB 以内（在全量测试并发环境）
    expect(heapDiff).toBeLessThan(50)
  }, 30000)
})
