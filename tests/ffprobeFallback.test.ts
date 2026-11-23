import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { buildDedupKey, buildSearchText } from '#shared/trackKey'
import { sniffTextualPayload } from '../server/utils/audioSniff'

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

vi.mock('../server/services/metadataService', () => ({
  writeAudioMetadata: vi.fn(async () => ({ ok: true })),
}))

// 关键：模拟「ffprobe 没装」——返回 unavailable 而不是 not-audio。
// 这正是飞牛包上 ffmpeg 可选依赖的真实情形（packaging/fnos/miyin/cmd/install_init 只告警）。
vi.mock('../server/utils/audioPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/audioPreview')>()
  return {
    ...actual,
    probeAudioContent: vi.fn(async () => ({ kind: 'unavailable' as const })),
  }
})

import { getTask, tickWorker } from '../server/services/downloadQueue'

const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta name="baidu_ssp_verify" content="xxxxx">
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

describe('sniffTextualPayload：内容自证', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'miyin-textual-'))
  })

  function make(name: string, content: Buffer | string): string {
    const p = join(dir, name)
    writeFileSync(p, content)
    return p
  }

  it('HTML 落地页 → html', () => {
    expect(sniffTextualPayload(make('a.html', HTML_PAGE))).toBe('html')
  })

  it('XML / JSON → 对应类型', () => {
    expect(sniffTextualPayload(make('a.xml', '<?xml version="1.0"?><rss></rss>'))).toBe('xml')
    expect(sniffTextualPayload(make('a.json', '{"code":403,"msg":"denied"}'))).toBe('json')
  })

  it('纯文本错误信息 → text', () => {
    expect(sniffTextualPayload(make('a.txt', 'upstream returned 502, please retry later\n'))).toBe(
      'text',
    )
  })

  it('真音频不被误判：flac 魔数 → null', () => {
    const buf = Buffer.alloc(1024, 0x41)
    buf.write('fLaC', 0, 'ascii')
    expect(sniffTextualPayload(make('a.flac', buf))).toBeNull()
  })

  it('含 NUL 的未知二进制 → null（放行，不扩大拒绝面）', () => {
    const buf = Buffer.alloc(1024)
    for (let i = 0; i < buf.length; i++) buf[i] = i % 251
    expect(sniffTextualPayload(make('a.bin', buf))).toBeNull()
  })

  it('以控制字节开头的音频（AC3 风格的 0x0B77）→ null', () => {
    const buf = Buffer.alloc(1024)
    buf[0] = 0x0b
    buf[1] = 0x77
    expect(sniffTextualPayload(make('a.ac3', buf))).toBeNull()
  })

  it('不存在的文件 → null', () => {
    expect(sniffTextualPayload(join(dir, 'nope.mp3'))).toBeNull()
  })
})

describe('ffprobe 不可用时不得把正常音频判成非音频', () => {
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined
  let downloadDir: string
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-noprobe-data-'))
    downloadDir = mkdtempSync(join(tmpdir(), 'miyin-noprobe-dl-'))
    process.env.DOWNLOAD_DIR = downloadDir
    upstream.pool = []

    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      )
      .run('src-a', '音源A', 'http://example.com/a.js', '/tmp/a.js', JSON.stringify(['tx']))

    server = createServer((req, res) => {
      const path = req.url || ''
      if (path.includes('html')) {
        const body = Buffer.from(HTML_PAGE, 'utf-8')
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) })
        res.end(body)
        return
      }
      // 既不是任何已知魔数、也不像文本的二进制（模拟冷门/未知容器）
      const body = Buffer.alloc(256 * 1024)
      for (let i = 0; i < body.length; i++) body[i] = i % 251
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      })
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
    const id = `noprobe-${Math.random().toString(36).slice(2)}`
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

  it('未知格式的二进制仍能落盘（不因缺 ffprobe 而拒收）', async () => {
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/blob.bin` }]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(15000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.source_id).toBe('src-a')
    expect(existsSync(task.file_path!)).toBe(true)
  })

  it('HTML 落地页在无 ffprobe 时仍被拒，不落盘', async () => {
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/html.mp3` }]

    const id = seedQueuedTask()
    void tickWorker()
    const failed = await waitUntil(15000, () => getTask(id)?.status === 'failed')
    expect(failed).toBe(true)

    const task = getTask(id)!
    expect(task.error).toContain('未返回可识别的音频内容')
    const files = readdirSync(downloadDir, { recursive: true }).map(String)
    expect(files.filter((f) => f.endsWith('.mp3') || f.endsWith('.flac'))).toEqual([])
    expect(files.filter((f) => f.includes('.part'))).toEqual([])
  })
})
