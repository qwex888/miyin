declare global {
  var createError: (input: {
    statusCode?: number
    statusMessage?: string
    message?: string
    data?: unknown
  }) => Error
}

if (!globalThis.createError) {
  globalThis.createError = (input) => {
    const err = new Error(input.message || input.statusMessage || 'Error') as Error & {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }
    err.statusCode = input.statusCode
    err.statusMessage = input.statusMessage
    err.data = input.data
    return err
  }
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { buildDedupKey, buildSearchText } from '#shared/trackKey'

/** 受控的音源 URL：由各用例改写，指向本地 HTTP server */
const upstream = vi.hoisted(() => ({ url: '' }))

vi.mock('../server/services/musicUrlResolve', () => ({
  isHighestQuality: (pref?: string | null) => !pref || pref === 'highest',
  // 取链层现在返回「候选列表」，且候选一到手就回调让调用方探测。
  // 本测试只关心落盘管线，因此恒返回唯一候选并立即回调。
  listMusicUrlCandidates: vi.fn(
    async (input: {
      onCandidate?: (c: {
        url: string
        quality: string
        sourceId: string
        sourceName: string
      }) => Promise<boolean | void> | boolean | void
    }) => {
      const candidate = {
        url: upstream.url,
        quality: 'flac',
        sourceId: 'test-source-1',
        sourceName: '测试音源',
      }
      await input.onCandidate?.(candidate)
      return {
        candidates: [candidate],
        errors: [],
        loadedCount: 1,
        excludedSkips: 0,
        truncated: false,
      }
    },
  ),
}))

// 元数据写入依赖 ffmpeg，测试环境不可靠 —— 直接视为成功（其失败本身不影响落盘）
vi.mock('../server/services/metadataService', () => ({
  writeAudioMetadata: vi.fn(async () => ({ ok: true })),
}))

// 试听时长与位深探测依赖 ffprobe，且测试用的假音频没有真实参数 → 覆盖探测函数（保持封闭）
vi.mock('../server/utils/audioPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/audioPreview')>()
  return { ...actual, probeAudioContent: vi.fn(async () => ({ kind: 'not-audio' as const })) }
})

import { enqueueDownload, getTask, cancelTask, tickWorker } from '../server/services/downloadQueue'

/** 伪造 FLAC 内容：魔数 fLaC，但 URL 结尾可以谎报 .mp3 */
function fakeAudio(bytes = 4096) {
  const buf = Buffer.alloc(bytes, 0x41)
  buf.write('fLaC', 0, 'ascii')
  return buf
}

async function waitUntil(timeoutMs: number, fn: () => boolean) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return fn()
}

function leftoverParts(dir: string) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.includes('.part'))
}

describe('D6-A：下载先落 .part，成功后原子 rename', () => {
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined
  let downloadDir: string
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-part-data-'))
    downloadDir = mkdtempSync(join(tmpdir(), 'miyin-part-dl-'))
    process.env.DOWNLOAD_DIR = downloadDir

    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      )
      .run('test-source-1', '测试音源', 'http://example.com/s.js', '/tmp/fake.js', JSON.stringify(['wy']))

    server = createServer((req, res) => {
      const url = req.url || ''
      if (url.startsWith('/fail')) {
        res.writeHead(500)
        res.end('nope')
        return
      }
      if (url.startsWith('/slow')) {
        // 保持连接、缓慢滴数据，供中途取消
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(64 * 1024) })
        const chunk = Buffer.alloc(1024, 0x41)
        res.write(chunk)
        const timer = setInterval(() => res.write(chunk), 60)
        res.on('close', () => clearInterval(timer))
        return
      }
      const body = fakeAudio()
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(body.length) })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    closeDb()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (prevDataDir) process.env.DATA_DIR = prevDataDir
    else delete process.env.DATA_DIR
    if (prevDownloadDir) process.env.DOWNLOAD_DIR = prevDownloadDir
    else delete process.env.DOWNLOAD_DIR
    vi.restoreAllMocks()
  })

  function enqueue(title: string, artist = '周杰伦') {
    return enqueueDownload({
      title,
      artist,
      platform: 'wy',
      downloadLyric: false,
      musicInfo: { songmid: `${artist}-${title}` },
    })
  }

  /**
   * 直插一个 queued 任务行。
   * 替换场景必须先写好 `music_info_json.__replaceOldFile` 再让 worker 取走 ——
   * 走 `enqueueDownload` 会立刻踢 worker，事后再 UPDATE 已经晚了（任务行已被读进内存）。
   */
  function seedQueuedTask(opts: {
    title: string
    artist: string
    musicInfo: Record<string, unknown>
  }) {
    const id = `seed-${Math.random().toString(36).slice(2)}`
    getDb()
      .prepare(
        `INSERT INTO download_tasks (
           id, title, artist, platform, source_id, quality, status, progress,
           music_info_json, dedup_key, search_text, created_at, updated_at
         ) VALUES (?, ?, ?, 'wy', 'test-source-1', 'flac', 'queued', 0, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        opts.title,
        opts.artist,
        JSON.stringify(opts.musicInfo),
        buildDedupKey(opts.artist, opts.title),
        buildSearchText({ title: opts.title, artist: opts.artist }),
      )
    return id
  }

  it('成功下载：按魔数纠正扩展名落盘，不留 .part 残留', async () => {
    // URL 谎报 .mp3，内容是 fLaC → 最终应为 .flac
    upstream.url = `${baseUrl}/ok.mp3`
    const task = enqueue('稻香')

    void tickWorker()
    const done = await waitUntil(8000, () => getTask(task.id)?.status === 'completed')
    expect(done).toBe(true)

    const finalTask = getTask(task.id)!
    expect(finalTask.file_path).toBe(join(downloadDir, '周杰伦 - 稻香.flac'))
    expect(readFileSync(finalTask.file_path!).subarray(0, 4).toString('ascii')).toBe('fLaC')
    expect(leftoverParts(downloadDir)).toEqual([])
    // 谎言命名的 .mp3 不应残留
    expect(readdirSync(downloadDir)).not.toContain('周杰伦 - 稻香.mp3')
  })

  it('下载失败：最终路径上的既有文件内容完好，不留残留', async () => {
    const existing = join(downloadDir, '周杰伦 - 稻香.flac')
    writeFileSync(existing, 'OLD-CONTENT')

    upstream.url = `${baseUrl}/fail.mp3`
    const task = enqueue('稻香')

    void tickWorker()
    await waitUntil(8000, () => {
      const s = getTask(task.id)?.status
      return s === 'failed' || s === 'queued' || s === 'completed'
    })

    const finalTask = getTask(task.id)!
    expect(finalTask.status).not.toBe('completed')
    // 核心保证：旧文件既没被覆盖也没被删除
    expect(readFileSync(existing, 'utf8')).toBe('OLD-CONTENT')
    expect(leftoverParts(downloadDir)).toEqual([])
  })

  it('下载中途取消：既有文件完好，临时文件被清理', async () => {
    const existing = join(downloadDir, '周杰伦 - 稻香.flac')
    writeFileSync(existing, 'OLD-CONTENT')

    upstream.url = `${baseUrl}/slow.mp3`
    const task = enqueue('稻香')

    void tickWorker()
    // 等临时文件出现，证明确实已经开始写盘
    const writing = await waitUntil(5000, () => leftoverParts(downloadDir).length > 0)
    expect(writing).toBe(true)

    cancelTask(task.id)
    await waitUntil(3000, () => leftoverParts(downloadDir).length === 0)

    expect(getTask(task.id)?.status).toBe('cancelled')
    expect(readFileSync(existing, 'utf8')).toBe('OLD-CONTENT')
    expect(leftoverParts(downloadDir)).toEqual([])
  })

  it('替换任务：新文件落地后才删除旧文件（R-d），旧路径不同不残留孤儿', async () => {
    // 旧文件（旧曲目标题 → 不同文件名）
    const oldFile = join(downloadDir, '周杰伦 - 稻香 (Live).flac')
    writeFileSync(oldFile, 'OLD-LIVE-CONTENT')

    upstream.url = `${baseUrl}/ok.mp3`
    const taskId = seedQueuedTask({
      title: '稻香',
      artist: '周杰伦',
      musicInfo: { songmid: 'x', __replaceOldFile: oldFile },
    })

    void tickWorker()
    const done = await waitUntil(8000, () => getTask(taskId)?.status === 'completed')
    expect(done).toBe(true)

    const finalTask = getTask(taskId)!
    expect(finalTask.file_path).toBe(join(downloadDir, '周杰伦 - 稻香.flac'))
    // 新文件在、旧文件被清掉（否则就是孤儿文件）
    expect(readdirSync(downloadDir).sort()).toEqual(['周杰伦 - 稻香.flac'])
    expect(leftoverParts(downloadDir)).toEqual([])
  })

  it('替换任务：下载失败时旧文件被保留、记录未标记完成', async () => {
    const oldFile = join(downloadDir, '周杰伦 - 稻香 (Live).flac')
    writeFileSync(oldFile, 'OLD-LIVE-CONTENT')

    upstream.url = `${baseUrl}/fail.mp3`
    const taskId = seedQueuedTask({
      title: '稻香',
      artist: '周杰伦',
      musicInfo: { songmid: 'x', __replaceOldFile: oldFile },
    })

    void tickWorker()
    await waitUntil(8000, () => {
      const s = getTask(taskId)?.status
      return s === 'failed' || s === 'queued' || s === 'completed'
    })

    expect(getTask(taskId)?.status).not.toBe('completed')
    // 旧文件仍在，且没有被新文件顶掉
    expect(readdirSync(downloadDir).sort()).toEqual(['周杰伦 - 稻香 (Live).flac'])
    expect(readFileSync(oldFile, 'utf8')).toBe('OLD-LIVE-CONTENT')
    expect(leftoverParts(downloadDir)).toEqual([])
  })
})
