import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { buildDedupKey, buildSearchText } from '#shared/trackKey'
import { probeAudioInfo } from '../server/utils/audioPreview'

/** 受控候选池：模拟取链层能拿到的「音源@档位 → URL」 */
const upstream = vi.hoisted(() => ({
  pool: [] as Array<{ sourceId: string; quality: string; url: string }>,
}))

vi.mock('../server/services/musicUrlResolve', () => ({
  isHighestQuality: (pref?: string | null) => !pref || pref === 'highest',
  listMusicUrlCandidates: vi.fn(
    async (input: {
      exclude?: ReadonlySet<string>
      limit?: number
      onCandidate?: (c: {
        url: string
        quality: string
        sourceId: string
        sourceName: string
      }) => Promise<boolean | void> | boolean | void
    }) => {
      const limit = input.limit ?? 8
      const keyOf = (e: { sourceId: string; quality: string }) => `${e.sourceId}@${e.quality}`
      const available = [...upstream.pool].filter((e) => !input.exclude?.has(keyOf(e)))
      const out = available.slice(0, limit).map((e) => ({
        url: e.url,
        quality: e.quality,
        sourceId: e.sourceId,
        sourceName: e.sourceId,
      }))
      for (const candidate of out) {
        if (input.onCandidate && (await input.onCandidate(candidate)) === false) break
      }
      return {
        candidates: out,
        errors: [],
        loadedCount: out.length,
        excludedSkips: upstream.pool.length - available.length,
        truncated: false,
      }
    },
  ),
}))

// 元数据写入依赖 ffmpeg，测试环境不可靠；其失败不影响落盘
vi.mock('../server/services/metadataService', () => ({
  writeAudioMetadata: vi.fn(async () => ({ ok: true })),
}))

// 时长/位深探测依赖 ffprobe；HTML 不是音频 → ffprobe 解析不出任何字段 → null。
// 这里显式覆盖，保证用例不依赖本机是否装了 ffprobe。
vi.mock('../server/utils/audioPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/audioPreview')>()
  return { ...actual, probeAudioInfo: vi.fn(async () => null) }
})

import { getTask, tickWorker } from '../server/services/downloadQueue'

/** 音源返回的 HTML 落地页（真实案例：107191 字节的验证页） */
const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta name="baidu_ssp_verify" content="xxxxx">
<meta name="360-site-verification" content="yyyyy">
</head>
<body>error</body>
</html>
`

async function waitUntil(timeoutMs: number, fn: () => boolean) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return fn()
}

describe('下载内容硬校验：HTML 落地页不得落盘（issue #45）', () => {
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined
  let downloadDir: string
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-html-data-'))
    downloadDir = mkdtempSync(join(tmpdir(), 'miyin-html-dl-'))
    process.env.DOWNLOAD_DIR = downloadDir
    upstream.pool = []
    vi.mocked(probeAudioInfo).mockReset()
    vi.mocked(probeAudioInfo).mockResolvedValue(null)

    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      )
      .run('src-a', '音源A', 'http://example.com/a.js', '/tmp/a.js', JSON.stringify(['tx']))
    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      )
      .run('src-b', '音源B', 'http://example.com/b.js', '/tmp/b.js', JSON.stringify(['tx']))

    server = createServer((req, res) => {
      const path = req.url || ''
      if (path.includes('html')) {
        const body = Buffer.from(HTML_PAGE, 'utf-8')
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) })
        res.end(body)
        return
      }
      // 真音频：fLaC 魔数
      const body = Buffer.alloc(256 * 1024, 0x41)
      body.write('fLaC', 0, 'ascii')
      res.writeHead(200, { 'content-type': 'audio/flac', 'content-length': String(body.length) })
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    closeDb()
    await new Promise<void>((r) => server.close(() => r()))
    if (prevDataDir) process.env.DATA_DIR = prevDataDir
    else delete process.env.DATA_DIR
    if (prevDownloadDir) process.env.DOWNLOAD_DIR = prevDownloadDir
    else delete process.env.DOWNLOAD_DIR
    vi.restoreAllMocks()
  })

  function seedQueuedTask() {
    const id = `html-${Math.random().toString(36).slice(2)}`
    getDb()
      .prepare(
        `INSERT INTO download_tasks (
           id, title, artist, platform, source_id, quality, status, progress,
           music_info_json, dedup_key, search_text, created_at, updated_at
         ) VALUES (?, '晴天', '周杰伦', 'tx', 'src-a', 'flac', 'queued', 0, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        JSON.stringify({ songmid: 'x' }),
        buildDedupKey('周杰伦', '晴天'),
        buildSearchText({ title: '晴天', artist: '周杰伦' }),
      )
    return id
  }

  function blockedOf(id: string): string[] {
    const info = JSON.parse(getTask(id)?.music_info_json || '{}')
    return Array.isArray(info.__previewBlocked) ? info.__previewBlocked : []
  }

  it('HTML 落地页：拒绝该候选并换下一个音源，不落盘', async () => {
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/html.mp3` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/ok.flac` },
    ]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(15000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    // 落到第二个音源（HTML 的那个被排除）
    expect(task.source_id).toBe('src-b')
    // 坏组合被记下
    expect(blockedOf(id)).toContain('src-a@flac')
    // 曲库里没有 .mp3（HTML 不该以任何名字落盘）
    const files = readdirSync(downloadDir, { recursive: true }).map(String)
    expect(files.filter((f) => f.endsWith('.mp3'))).toEqual([])
    expect(files.filter((f) => f.includes('.part'))).toEqual([])
  })

  it('全部候选都是 HTML：任务失败并给出「内容不是音频」的准确提示', async () => {
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/html1.mp3` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/html2.mp3` },
    ]

    const id = seedQueuedTask()
    void tickWorker()
    const failed = await waitUntil(15000, () => getTask(id)?.status === 'failed')
    expect(failed).toBe(true)

    const task = getTask(id)!
    expect(task.error).toContain('未返回可识别的音频内容')
    // 曲库保持干净
    const files = readdirSync(downloadDir, { recursive: true }).map(String)
    expect(files.filter((f) => f.endsWith('.mp3') || f.endsWith('.flac'))).toEqual([])
  })

  it('真音频仍能正常落盘（回归锚点：硬校验不能误伤正常文件）', async () => {
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/ok.flac` }]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(15000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.source_id).toBe('src-a')
    expect(existsSync(task.file_path!)).toBe(true)
    expect(task.file_path).toContain('.flac')
  })
})
