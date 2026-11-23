import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb } from '../server/utils/db'
import { enqueueDownload, getTask } from '../server/services/downloadQueue'
import { isValidSourceId, assertSafeSourceId } from '../server/utils/sourceId'
import { relativeRequestPath, getAppBaseURL } from '../server/utils/requestPath'

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
 * 三处「看起来只是小疏漏、实际是权限边界」的回归：
 *
 * 1. 飞牛 baseURL `/app/miyin/` 下 `getRequestURL().pathname` 带前缀 →
 *    鉴权中间件把 `/api/` 判成非接口 → **整站免鉴权**
 * 2. bundle manifest 的 `sources[].id` 直接拼进缓存路径 → 路径穿越任意 .js 写入
 * 3. 客户端可在 `musicInfo` 里透传 `__replaceOldFile` → 下载成功后 unlink 任意文件
 */
describe('鉴权：请求路径归一化', () => {
  let prevBase: string | undefined
  let prevNuxtBase: string | undefined

  beforeEach(() => {
    prevBase = process.env.GATEWAY_PREFIX
    prevNuxtBase = process.env.NUXT_APP_BASE_URL
    delete process.env.GATEWAY_PREFIX
    delete process.env.NUXT_APP_BASE_URL
  })

  afterEach(() => {
    if (prevBase === undefined) delete process.env.GATEWAY_PREFIX
    else process.env.GATEWAY_PREFIX = prevBase
    if (prevNuxtBase === undefined) delete process.env.NUXT_APP_BASE_URL
    else process.env.NUXT_APP_BASE_URL = prevNuxtBase
  })

  it('有 event.path 时直接用（h3 已剥掉挂载前缀）', () => {
    expect(relativeRequestPath({ path: '/api/downloads' })).toBe('/api/downloads')
  })

  it('只有 originalUrl 时按 baseURL 剥离：/app/miyin/api/x → /api/x', () => {
    process.env.GATEWAY_PREFIX = '/app/miyin'
    expect(getAppBaseURL()).toBe('/app/miyin/')
    expect(
      relativeRequestPath({ node: { req: { originalUrl: '/app/miyin/api/downloads' } } }),
    ).toBe('/api/downloads')
  })

  it('根路径部署下不做多余处理', () => {
    delete process.env.GATEWAY_PREFIX
    process.env.NUXT_APP_BASE_URL = '/'
    expect(relativeRequestPath({ node: { req: { originalUrl: '/api/downloads' } } })).toBe(
      '/api/downloads',
    )
  })

  it('带前缀的路径不会被误判成 /api/ 开头（这就是免鉴权的成因）', () => {
    process.env.GATEWAY_PREFIX = '/app/miyin'
    const p = relativeRequestPath({ node: { req: { originalUrl: '/app/miyin/api/sources' } } })
    expect(p.startsWith('/api/')).toBe(true)
  })
})

describe('音源 id 校验', () => {
  it('正常 id（16 位十六进制 / 带点划线的名字）通过', () => {
    expect(isValidSourceId('a1b2c3d4e5f60712')).toBe(true)
    expect(isValidSourceId('my-source.v2')).toBe(true)
  })

  it('路径穿越与分隔符一律拒绝', () => {
    for (const bad of ['../evil', '../../../../tmp/x', 'a/b', 'a\\b', '..', '.', '', 'x'.repeat(65)]) {
      expect(isValidSourceId(bad)).toBe(false)
    }
  })

  it('assertSafeSourceId 抛 400', () => {
    expect(() => assertSafeSourceId('../evil')).toThrowError(/音源 ID 不合法/)
    try {
      assertSafeSourceId('a/b')
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(400)
    }
  })
})

describe('入队：客户端不能透传内部字段', () => {
  let prevDataDir: string | undefined
  let prevDownloadDir: string | undefined

  beforeEach(() => {
    closeDb()
    prevDataDir = process.env.DATA_DIR
    prevDownloadDir = process.env.DOWNLOAD_DIR
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'miyin-sec-data-'))
    process.env.DOWNLOAD_DIR = mkdtempSync(join(tmpdir(), 'miyin-sec-dl-'))
    getDb()
      .prepare(
        `INSERT INTO sources (id, name, url, local_path, enabled, status, platforms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ok', ?, datetime('now'), datetime('now'))`,
      )
      .run('src-1', '测试音源', 'http://example.com/s.js', '/tmp/fake.js', JSON.stringify(['wy']))
  })

  afterEach(() => {
    closeDb()
    if (prevDataDir) process.env.DATA_DIR = prevDataDir
    else delete process.env.DATA_DIR
    if (prevDownloadDir) process.env.DOWNLOAD_DIR = prevDownloadDir
    else delete process.env.DOWNLOAD_DIR
  })

  it('__replaceOldFile / __replaceOldLyric 被丢弃（否则可删任意文件）', () => {
    const task = enqueueDownload({
      title: '稻香',
      artist: '周杰伦',
      platform: 'wy',
      musicInfo: {
        songmid: 'x',
        __replaceOldFile: '/tmp/important.txt',
        __replaceOldLyric: '/tmp/important.lrc',
        __previewBlocked: ['src-1@flac'],
        __blockedReasons: { 'src-1@flac': 'invalid' },
      },
    })
    const info = JSON.parse(getTask(task.id)!.music_info_json || '{}')
    expect(info.__replaceOldFile).toBeUndefined()
    expect(info.__replaceOldLyric).toBeUndefined()
    expect(info.__previewBlocked).toBeUndefined()
    expect(info.__blockedReasons).toBeUndefined()
    // 普通字段照常保留
    expect(info.songmid).toBe('x')
  })

  it('服务端自己写入的 __downloadLyric / __lyricMode / __folderPrefix 不受影响', () => {
    const task = enqueueDownload({
      title: '稻香',
      artist: '周杰伦',
      platform: 'wy',
      musicInfo: { songmid: 'y' },
      downloadLyric: true,
      lyricMode: 'embedded',
      folderPrefix: '周杰伦/叶惠美',
    })
    const info = JSON.parse(getTask(task.id)!.music_info_json || '{}')
    expect(info.__downloadLyric).toBe(true)
    expect(info.__lyricMode).toBe('embedded')
    expect(info.__folderPrefix).toBe('周杰伦/叶惠美')
  })

  it('替换路径仍由服务端从既有记录生成', () => {
    // 已有一条完成任务，再入队同曲 → replace 时服务端写入 __replaceOldFile
    const first = enqueueDownload({
      title: '稻香',
      artist: '周杰伦',
      platform: 'wy',
      musicInfo: { songmid: 'old' },
    })
    getDb()
      .prepare(`UPDATE download_tasks SET status='completed', file_path='/tmp/old.flac' WHERE id=?`)
      .run(first.id)

    const outcome = enqueueDownload(
      { title: '稻香', artist: '周杰伦', platform: 'wy', musicInfo: { songmid: 'new' } },
    )
    // 无条件入队（enqueueDownload）不判重，这里只验证不会被客户端的同名键污染
    const info = JSON.parse(getTask(outcome.id)!.music_info_json || '{}')
    expect(info.__replaceOldFile).toBeUndefined()
  })
})
