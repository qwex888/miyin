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
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { buildDedupKey, buildSearchText } from '#shared/trackKey'
import { probeAudioContent } from '../server/utils/audioPreview'
import { saveSettings } from '../server/services/settingsService'

/** 受控候选池：模拟取链层能拿到的「音源@档位 → URL」 */
const upstream = vi.hoisted(() => ({
  pool: [] as Array<{ sourceId: string; quality: string; url: string }>,
  calls: [] as Array<{ exclude: string[]; limit: number }>,
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
      upstream.calls.push({ exclude: input.exclude ? [...input.exclude] : [], limit })
      const keyOf = (e: { sourceId: string; quality: string }) => `${e.sourceId}@${e.quality}`
      const queued = [...upstream.pool]
      const available = queued.filter((e) => !input.exclude?.has(keyOf(e)))
      const picked = available.slice(0, limit)
      const out = picked.map((e) => ({
        url: e.url,
        quality: e.quality,
        sourceId: e.sourceId,
        sourceName: e.sourceId,
      }))
      // 与真实实现一致：候选一到手就回调（调用方在此探测并可能要求提前收工）
      let stopped = false
      for (const candidate of out) {
        if (input.onCandidate && (await input.onCandidate(candidate)) === false) {
          stopped = true
          break
        }
      }
      return {
        candidates: out,
        errors: [],
        loadedCount: 2,
        excludedSkips: queued.length - available.length,
        truncated: stopped || available.length > picked.length,
      }
    },
  ),
}))

// 元数据写入依赖 ffmpeg，测试环境不可靠；其失败不影响落盘
vi.mock('../server/services/metadataService', () => ({
  writeAudioMetadata: vi.fn(async () => ({ ok: true })),
}))

// 时长/位深探测依赖 ffprobe；假音频没有真实参数 → 连探测函数一起覆盖（保持测试封闭）
vi.mock('../server/utils/audioPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/audioPreview')>()
  return { ...actual, probeAudioContent: vi.fn(async () => ({ kind: 'not-audio' as const })) }
})

import { getTask, retryTask, tickWorker } from '../server/services/downloadQueue'

/** 期望时长 60s —— 体积↔码率换算：kbps ≈ bytes × 8 ÷ 60 ÷ 1000 */
const INTERVAL = '1:00'
const DURATION = 60
const kbpsOf = (bytes: number) => Math.round((bytes * 8) / DURATION / 1000)

/** 41kbps：低于 MIN_KBPS_ANY(80) → 探测阶段即判为试听片段 */
const TRIAL_BYTES = 300 * 1024
/** 328kbps：像 320k mp3，配不上它声称的 flac24bit → implausible（降级但可兜底） */
const LOW_BYTES = Math.round(2.4 * 1024 * 1024)
/** 978kbps：真无损，配得上 flac */
const FULL_BYTES = 7 * 1024 * 1024
/** 1677kbps：码率看似 Hi-Res，但内容是 mp3 → 只能靠 L2 魔数识破 */
const FAKE_HIRES_BYTES = 12 * 1024 * 1024

async function waitUntil(timeoutMs: number, fn: () => boolean) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return fn()
}

describe('候选择优：落到实测质量最好的音源', () => {
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined
  let downloadDir: string
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-pick-data-'))
    downloadDir = mkdtempSync(join(tmpdir(), 'miyin-pick-dl-'))
    process.env.DOWNLOAD_DIR = downloadDir
    upstream.pool = []
    upstream.calls = []
    // 默认探测失败（假音频没有真实参数）；需要位深的用例自行 mockResolvedValueOnce
    vi.mocked(probeAudioContent).mockReset()
    vi.mocked(probeAudioContent).mockResolvedValue({ kind: 'not-audio' })

    const db = getDb()
    const insertSource = db.prepare(
      `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
    )
    insertSource.run('src-a', '音源A', 'http://example.com/a.js', '/tmp/a.js', JSON.stringify(['tx']))
    insertSource.run('src-b', '音源B', 'http://example.com/b.js', '/tmp/b.js', JSON.stringify(['tx']))

    server = createServer((req, res) => {
      const path = req.url || ''
      const isFakeMp3 = path.includes('fake-mp3')
      const size = path.includes('trial')
        ? TRIAL_BYTES
        : isFakeMp3
          ? FAKE_HIRES_BYTES
          : path.includes('hires-flac')
            ? FAKE_HIRES_BYTES
            : path.includes('low')
              ? LOW_BYTES
              : FULL_BYTES
      const body = Buffer.alloc(size, 0x41)
      // 魔数决定 L2 嗅探结果：mp3 用 ID3，其余用 fLaC
      if (isFakeMp3) body.write('ID3', 0, 'ascii')
      else body.write('fLaC', 0, 'ascii')
      res.writeHead(200, { 'content-type': 'audio/flac', 'content-length': String(size) })
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

  function seedQueuedTask() {
    const id = `pick-${Math.random().toString(36).slice(2)}`
    getDb()
      .prepare(
        `INSERT INTO download_tasks (
           id, title, artist, platform, source_id, quality, status, progress,
           music_info_json, dedup_key, search_text, created_at, updated_at
         ) VALUES (?, '稻香', '周杰伦', 'tx', 'src-a', 'highest', 'queued', 0, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        JSON.stringify({ songmid: 'x', interval: INTERVAL }),
        buildDedupKey('周杰伦', '稻香'),
        buildSearchText({ title: '稻香', artist: '周杰伦' }),
      )
    return id
  }

  function blockedOf(id: string): string[] {
    const info = JSON.parse(getTask(id)?.music_info_json || '{}')
    return Array.isArray(info.__previewBlocked) ? info.__previewBlocked : []
  }

  it('谎报 flac24bit 的 320k 不再胜出：按实测码率选真无损', async () => {
    // 基准自查：体积换算出来的码率确实分属两档
    expect(kbpsOf(LOW_BYTES)).toBeLessThan(700)
    expect(kbpsOf(FULL_BYTES)).toBeGreaterThan(700)

    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac24bit', url: `${baseUrl}/low.flac` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/full.flac` },
    ]
    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    // 声称 flac24bit 的那个只有 328kbps → 被排到后面；选中实测 978kbps 的真无损
    expect(task.source_id).toBe('src-b')
    expect(task.quality).toBe('flac')
    expect(task.file_size).toBe(FULL_BYTES)
    expect(readdirSync(downloadDir).filter((f) => f.includes('.part'))).toEqual([])
  })

  it('L2 兜底：码率看似达标但内容是 mp3 → 识破并换下一个候选', async () => {
    // src-a 的 12MB 换算成 1677kbps，L1 认为配得上 flac24bit → 会先下载
    // 但内容是 mp3（魔数 ID3）→ L2 判为谎报 → 排除后落到 src-b
    expect(kbpsOf(FAKE_HIRES_BYTES)).toBeGreaterThan(1400)
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac24bit', url: `${baseUrl}/fake-mp3.flac` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/full.flac` },
    ]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(15000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.source_id).toBe('src-b')
    expect(task.file_size).toBe(FULL_BYTES)
    // 谎报的组合被记下，下次不再选中
    expect(blockedOf(id)).toContain('src-a@flac24bit')
  })

  it('试听片段（41kbps）在探测阶段就被排除，不会白下载', async () => {
    expect(kbpsOf(TRIAL_BYTES)).toBeLessThan(80)
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/trial.flac` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/full.flac` },
    ]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.source_id).toBe('src-b')
    expect(task.file_size).toBe(FULL_BYTES)
  })

  it('全部候选都是试听 → 明确报错，说明已试过多少个组合', async () => {
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/trial1.flac` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/trial2.flac` },
    ]
    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(15000, () => getTask(id)?.status === 'failed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.error).toContain('均只返回试听片段')
    expect(task.error).toMatch(/已试过 \d+ 个音源\/音质组合/)
    expect(blockedOf(id).length).toBeGreaterThanOrEqual(2)
  })

  it('手动重试带上已排除的组合（不会重头再试同一个音源）', async () => {
    upstream.pool = [
      { sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/trial1.flac` },
      { sourceId: 'src-b', quality: 'flac', url: `${baseUrl}/trial2.flac` },
    ]
    const id = seedQueuedTask()
    void tickWorker()
    await waitUntil(15000, () => getTask(id)?.status === 'failed')
    const blockedBefore = blockedOf(id)
    expect(blockedBefore.length).toBeGreaterThanOrEqual(2)

    upstream.calls = []
    upstream.pool = [{ sourceId: 'src-c', quality: 'flac', url: `${baseUrl}/full.flac` }]
    retryTask(id, { resetAttempts: true })
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    expect(upstream.calls[0]!.exclude.length).toBeGreaterThanOrEqual(blockedBefore.length)
    expect(upstream.calls[0]!.exclude).toContain('src-a@flac')
  })

  it('单候选正常路径：探测通过即下载（回归锚点）', async () => {
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac', url: `${baseUrl}/full.flac` }]
    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.file_size).toBe(FULL_BYTES)
    expect(upstream.calls.length).toBe(1)
    expect(upstream.calls[0]!.exclude).toEqual([])
  })

  it('L3：实测位深不足 24bit → 修正档位，且文件名里的 {quality} 同步改掉', async () => {
    // 命名模板带 {quality}，才能验证"文件名与记录一致"
    saveSettings({ nameTemplate: '{artist} - {title} [{quality}]' })
    // 12MB/60s ≈ 1677kbps → 对 flac24bit 判为 ok，于是 quality 会保持声称值进入 L3
    // 内容用 fLaC 魔数（不是 mp3），避免被 L2 先拦下
    vi.mocked(probeAudioContent).mockResolvedValueOnce({
      kind: 'ok',
      info: {
        durationSec: null,
        codec: 'flac',
        sampleRate: 44100,
        bitsPerRawSample: 16,
        channels: 6,
      },
    })
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac24bit', url: `${baseUrl}/hires-flac.flac` }]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    // 记录档位被修正
    expect(task.quality).toBe('flac')
    // 文件名同步一致，不再自相矛盾
    expect(task.file_path).toContain('[flac]')
    expect(task.file_path).not.toContain('flac24bit')
    expect(existsSync(task.file_path!)).toBe(true)
    // 文件字节数不变 —— 只改标签，不重下
    expect(task.file_size).toBe(FAKE_HIRES_BYTES)
  })

  it('L3：实测确实是 24bit → 档位与文件名都保持 flac24bit（不该被误降）', async () => {
    saveSettings({ nameTemplate: '{artist} - {title} [{quality}]' })
    vi.mocked(probeAudioContent).mockResolvedValueOnce({
      kind: 'ok',
      info: {
        durationSec: null,
        codec: 'flac',
        sampleRate: 96000,
        bitsPerRawSample: 24,
        channels: 2,
      },
    })
    upstream.pool = [{ sourceId: 'src-a', quality: 'flac24bit', url: `${baseUrl}/hires-flac.flac` }]

    const id = seedQueuedTask()
    void tickWorker()
    const done = await waitUntil(10000, () => getTask(id)?.status === 'completed')
    expect(done).toBe(true)

    const task = getTask(id)!
    expect(task.quality).toBe('flac24bit')
    expect(task.file_path).toContain('[flac24bit]')
  })
})
