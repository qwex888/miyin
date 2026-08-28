import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto'
import { inflate as zlibInflate, deflate as zlibDeflate } from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script, createContext, runInContext } from 'node:vm'
import { request as httpRequest } from 'node:https'
import { request as httpRequestPlain } from 'node:http'
import { URL } from 'node:url'
import { promisify } from 'node:util'

const inflateAsync = promisify(zlibInflate)
const deflateAsync = promisify(zlibDeflate)

export type LxSourceHandle = {
  platforms: string[]
  qualityMap: Record<string, string[]>
  getMusicUrl: (platform: string, musicInfo: Record<string, any>, quality: string) => Promise<string>
  dispose: () => void
  sourceKey: string
  /** 脚本 checkUpdate / updateAlert 推送的提示（如版本过旧） */
  updateAlerts: string[]
}

const LOAD_TIMEOUT_MS = Number(process.env.MIYIN_SOURCE_LOAD_TIMEOUT_MS || 5000)
const INIT_WAIT_MS = Number(process.env.MIYIN_SOURCE_INIT_WAIT_MS || 10000)
const CALL_TIMEOUT_MS = Number(process.env.MIYIN_SOURCE_CALL_TIMEOUT_MS || 20000)
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_TIMERS = 32
const MAX_FAILS_BEFORE_BREAK = 3
const BREAK_MS = 60_000

type CacheEntry = {
  handle: LxSourceHandle
  mtimeMs: number
  loadedAt: number
}

const handleCache = new Map<string, CacheEntry>()
const failCircuit = new Map<string, { fails: number; openUntil: number }>()

const BLOCKED_REQUIRE = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
  'os',
  'node:os',
  'net',
  'node:net',
  'dgram',
  'node:dgram',
  'cluster',
  'node:cluster',
  'vm',
  'node:vm',
])

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时(${ms}ms)`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

const NETWORK_ERR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
])

/** 音源脚本 checkUpdate / 取链时常见的可降级网络错误 */
export function isBenignSourceNetworkError(reason: unknown): boolean {
  const err = reason as { code?: string; message?: string } | null
  if (err?.code && NETWORK_ERR_CODES.has(err.code)) return true
  const msg = String(err?.message || reason || '')
  return /getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|EHOSTUNREACH|request timeout|socket hang up|音源响应体过大/i.test(
    msg,
  )
}

/** 第三方音源脚本常见空值访问等，guard 窗口内降为 warn，避免刷 [unhandledRejection] */
export function isBenignSourceScriptError(reason: unknown): boolean {
  if (isBenignSourceNetworkError(reason)) return true
  const msg = String((reason as { message?: string } | null)?.message || reason || '')
  return /Cannot read propert(y|ies) of (undefined|null)/i.test(msg)
}

type RejectionBucket = { errors: Error[] }

let rejectionGuardDepth = 0
let rejectionGuardHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null = null
let rejectionGuardSaved: Array<(...args: any[]) => void> = []
let rejectionGuardHoldTimer: NodeJS.Timeout | null = null
const rejectionBuckets = new Set<RejectionBucket>()

function ensureRejectionGuard() {
  if (rejectionGuardHandler) return
  rejectionGuardSaved = process.listeners('unhandledRejection').slice() as Array<(...args: any[]) => void>
  for (const l of rejectionGuardSaved) {
    process.removeListener('unhandledRejection', l)
  }
  rejectionGuardHandler = (reason: unknown, promise: Promise<unknown>) => {
    if (isBenignSourceScriptError(reason)) {
      const e = reason instanceof Error ? reason : new Error(String(reason))
      for (const b of rejectionBuckets) b.errors.push(e)
      const kind = isBenignSourceNetworkError(reason) ? 'network error' : 'script error'
      console.warn(`[source] ${kind}:`, e.message)
      // 已临时接管 unhandledRejection 监听，不再事后 catch（避免 PromiseRejectionHandledWarning）
      void promise
      return
    }
    for (const l of rejectionGuardSaved) {
      try {
        l(reason, promise)
      } catch {
        /* ignore listener errors */
      }
    }
  }
  process.on('unhandledRejection', rejectionGuardHandler)
}

function teardownRejectionGuard() {
  if (!rejectionGuardHandler) return
  process.removeListener('unhandledRejection', rejectionGuardHandler)
  rejectionGuardHandler = null
  for (const l of rejectionGuardSaved) {
    if (!process.listeners('unhandledRejection').includes(l)) {
      process.on('unhandledRejection', l)
    }
  }
  rejectionGuardSaved = []
}

/**
 * 在音源加载/检测窗口内拦截脚本未 catch 的网络/空值访问 Promise 拒绝，
 * 降级为 warn，避免 Nuxt 打出 [unhandledRejection]。
 */
export function acquireSourceRejectionGuard(): {
  errors: Error[]
  release: () => void
} {
  const bucket: RejectionBucket = { errors: [] }
  ensureRejectionGuard()
  rejectionGuardDepth += 1
  rejectionBuckets.add(bucket)
  if (rejectionGuardHoldTimer) {
    clearTimeout(rejectionGuardHoldTimer)
    rejectionGuardHoldTimer = null
  }
  let released = false
  return {
    get errors() {
      return bucket.errors
    },
    release() {
      if (released) return
      released = true
      rejectionBuckets.delete(bucket)
      rejectionGuardDepth = Math.max(0, rejectionGuardDepth - 1)
      if (rejectionGuardDepth === 0) {
        teardownRejectionGuard()
      }
    },
  }
}

/** 加载成功后短暂续命 guard，覆盖脚本 fire-and-forget 的 checkUpdate */
function holdSourceRejectionGuard(ms: number) {
  ensureRejectionGuard()
  rejectionGuardDepth += 1
  if (rejectionGuardHoldTimer) clearTimeout(rejectionGuardHoldTimer)
  rejectionGuardHoldTimer = setTimeout(() => {
    rejectionGuardHoldTimer = null
    rejectionGuardDepth = Math.max(0, rejectionGuardDepth - 1)
    if (rejectionGuardDepth === 0) teardownRejectionGuard()
  }, ms)
}

export function resetSourceRejectionGuardForTests() {
  if (rejectionGuardHoldTimer) {
    clearTimeout(rejectionGuardHoldTimer)
    rejectionGuardHoldTimer = null
  }
  rejectionGuardDepth = 0
  rejectionBuckets.clear()
  teardownRejectionGuard()
}

/** 等待脚本异步 checkUpdate 落定，返回窗口内捕获的网络错误 */
export async function settleSourceNetworkErrors(
  guard: { errors: Error[] },
  ms = Number(process.env.MIYIN_SOURCE_UPDATE_GRACE_MS || 2500),
) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
  return guard.errors.slice()
}

function nodeHttpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: any },
  cb: (err: any, resp?: { statusCode: number; body: any; headers: any }) => void,
) {
  let settled = false
  const done = (err: any, resp?: { statusCode: number; body: any; headers: any }) => {
    if (settled) return
    settled = true
    try {
      cb(err, resp)
    } catch (e) {
      console.error('[source] request callback error', e)
    }
  }
  try {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? httpRequestPlain : httpRequest
    const method = (options.method || 'GET').toUpperCase()
    const headers = { ...(options.headers || {}) }
    let payload: string | undefined
    if (options.body != null) {
      payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json'
      }
      headers['Content-Length'] = String(Buffer.byteLength(payload))
    }
    const req = lib(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        const MAX = 8 * 1024 * 1024
        res.on('data', (c) => {
          size += c.length
          if (size > MAX) {
            req.destroy()
            done(new Error('音源响应体过大'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: any = raw
          const ct = String(res.headers['content-type'] || '')
          if (ct.includes('json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
            try {
              body = JSON.parse(raw)
            } catch {
              body = raw
            }
          }
          done(null, { statusCode: res.statusCode || 0, body, headers: res.headers })
        })
        res.on('error', (err) => done(err))
      },
    )
    req.on('error', (err) => done(err))
    req.on('timeout', () => {
      req.destroy()
      done(new Error('request timeout'))
    })
    if (payload) req.write(payload)
    req.end()
  } catch (err) {
    done(err)
  }
}

/**
 * 对齐洛雪桌面端：支持 callback，同时返回 Promise。
 * 仅用 callback 时自动吞掉 Promise 拒绝，避免 unhandledRejection。
 */
function lxRequest(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: any } | ((err: any, resp?: any) => void),
  callback?: (err: any, resp?: any) => void,
): Promise<{ statusCode: number; body: any; headers: any }> {
  let opts: { method?: string; headers?: Record<string, string>; body?: any } = {}
  let cb = callback
  if (typeof options === 'function') {
    cb = options
    opts = {}
  } else if (options) {
    opts = options
  }
  const p = new Promise<{ statusCode: number; body: any; headers: any }>((resolve, reject) => {
    nodeHttpRequest(url, opts, (err, resp) => {
      if (err) reject(err)
      else resolve(resp!)
    })
  })
  if (cb) {
    p.then(
      (resp) => cb!(null, resp),
      (err) => cb!(err),
    )
    // callback 路径已交付错误，避免仅用 callback 时出现 unhandledRejection
    p.catch(() => {})
  }
  return p
}

function assertCircuitClosed(key: string) {
  const c = failCircuit.get(key)
  if (c && c.openUntil > Date.now()) {
    throw new Error(`音源熔断中，请稍后再试（${Math.ceil((c.openUntil - Date.now()) / 1000)}s）`)
  }
}

function recordSuccess(key: string) {
  failCircuit.delete(key)
}

function recordFailure(key: string) {
  const cur = failCircuit.get(key) || { fails: 0, openUntil: 0 }
  cur.fails += 1
  if (cur.fails >= MAX_FAILS_BEFORE_BREAK) {
    cur.openUntil = Date.now() + BREAK_MS
    cur.fails = 0
  }
  failCircuit.set(key, cur)
}

function createRestrictedRequire(parentRequire: NodeRequire) {
  return (id: string) => {
    if (BLOCKED_REQUIRE.has(id) || id.startsWith('fs') || id.includes('child_process')) {
      throw new Error(`沙箱禁止 require('${id}')`)
    }
    // 仅允许少量加密/工具库
    if (id === 'crypto' || id === 'node:crypto' || id === 'buffer' || id === 'node:buffer' || id === 'url' || id === 'node:url') {
      return parentRequire(id)
    }
    throw new Error(`沙箱禁止 require('${id}')`)
  }
}

/** 解析洛雪音源脚本头部 @name / @version 等元数据 */
export function parseScriptHeader(code: string) {
  const head = code.slice(0, 4000)
  const get = (key: string) => {
    const m = head.match(new RegExp(`@${key}\\s+([^\\r\\n*]+)`, 'i'))
    return (m?.[1] || '').trim()
  }
  return {
    name: get('name'),
    description: get('description'),
    version: get('version'),
    author: get('author'),
    homepage: get('homepage'),
    rawScript: code,
  }
}

function createLxUtils() {
  return {
    buffer: {
      from: (...args: any[]) => Buffer.from(...(args as [any])),
      bufToString: (buf: Buffer | string, format?: BufferEncoding) => {
        if (typeof buf === 'string') return Buffer.from(buf, 'binary').toString(format || 'utf8')
        return Buffer.from(buf).toString(format || 'utf8')
      },
    },
    crypto: {
      // 对齐洛雪桌面端 userApi preload 实现
      aesEncrypt(buffer: any, mode: string, key: any, iv: any) {
        const cipher = createCipheriv(mode, key, iv)
        return Buffer.concat([cipher.update(buffer), cipher.final()])
      },
      rsaEncrypt(buffer: any, key: any) {
        const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
        const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - buf.length)), buf])
        return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, padded)
      },
      randomBytes(size: number) {
        return randomBytes(size)
      },
      md5(str: string) {
        return createHash('md5').update(String(str)).digest('hex')
      },
    },
    zlib: {
      inflate: (buf: Buffer) => inflateAsync(buf),
      deflate: (data: Buffer) => deflateAsync(data),
    },
  }
}

/**
 * 加载洛雪兼容音源脚本（提供 globalThis.lx 沙箱）
 * - 同步执行带 timeout，防止死循环
 * - 支持异步 inited（如花源先拉远端配置）
 * - 定时器数量上限，dispose 时清理
 * - getMusicUrl 带 Promise 超时
 * - 按路径+mtime 缓存，连续失败熔断
 */
export async function loadLxSource(localPath: string, opts?: { bypassCache?: boolean }): Promise<LxSourceHandle> {
  const st = statSync(localPath)
  const key = `${localPath}:${st.mtimeMs}`
  assertCircuitClosed(localPath)

  if (!opts?.bypassCache) {
    const hit = handleCache.get(key)
    if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) {
      return hit.handle
    }
  }

  const code = readFileSync(localPath, 'utf8')
  if (code.length > 2 * 1024 * 1024) {
    throw new Error('音源脚本过大，拒绝加载')
  }

  const handlers: Array<(payload: any) => any> = []
  const updateAlerts: string[] = []
  let platforms: string[] = []
  let qualityMap: Record<string, string[]> = {}
  let disposed = false
  let didInit = false
  let resolveInit: (() => void) | null = null
  const initPromise = new Promise<void>((resolve) => {
    resolveInit = resolve
  })
  const timers = new Set<NodeJS.Timeout>()

  const EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
  }

  const trackTimer = (id: NodeJS.Timeout) => {
    if (disposed) {
      clearTimeout(id)
      return id
    }
    if (timers.size >= MAX_TIMERS) {
      clearTimeout(id)
      throw new Error('沙箱定时器数量超限')
    }
    timers.add(id)
    return id
  }

  const safeSetTimeout = (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!disposed) fn(...args)
    }, ms)
    return trackTimer(id)
  }
  const safeSetInterval = (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    const id = setInterval(() => {
      if (disposed) {
        clearInterval(id)
        timers.delete(id)
        return
      }
      fn(...args)
    }, ms)
    return trackTimer(id)
  }
  const safeClear = (id: any) => {
    clearTimeout(id)
    clearInterval(id)
    timers.delete(id)
  }

  const failLoad = (message: string): never => {
    for (const t of timers) safeClear(t)
    recordFailure(localPath)
    throw new Error(message)
  }

  const parentRequire = createRequire(import.meta.url)
  const scriptInfo = parseScriptHeader(code)
  const lx = {
    EVENT_NAMES,
    env: 'desktop',
    // 自定义源 API 版本（与洛雪桌面端一致，不是应用版本号）
    version: '2.0.0',
    currentScriptInfo: scriptInfo,
    utils: createLxUtils(),
    request: lxRequest,
    on(name: string, fn: (payload: any) => any) {
      if (name === EVENT_NAMES.request) handlers.push(fn)
      return Promise.resolve()
    },
    send(name: string, payload: any) {
      if (name === EVENT_NAMES.inited) {
        didInit = true
        const sources = payload?.sources || payload?.init?.sources || {}
        const srcObj = sources.sources || sources
        platforms = Object.keys(srcObj || {}).filter((k) => k && typeof (srcObj as any)[k] === 'object')
        qualityMap = {}
        for (const [k, v] of Object.entries(srcObj || {}) as Array<[string, any]>) {
          if (!v || typeof v !== 'object') continue
          qualityMap[k] = v?.qualitys || ['128k']
        }
        if (payload?.init?.sources) {
          platforms = Object.keys(payload.init.sources)
          for (const [k, v] of Object.entries(payload.init.sources) as Array<[string, any]>) {
            qualityMap[k] = v?.qualitys || ['128k']
          }
        }
        resolveInit?.()
      }
      // updateAlert：记录供检测展示（如脚本版本过旧）
      if (name === EVENT_NAMES.updateAlert) {
        const text = String(payload?.log || payload?.message || payload || '').trim()
        if (text) updateAlerts.push(text)
        console.warn('[source] updateAlert', text || payload)
      }
      return Promise.resolve()
    },
  }

  const sandbox: Record<string, any> = {
    console: {
      log: (...a: any[]) => console.log('[source]', ...a),
      warn: (...a: any[]) => console.warn('[source]', ...a),
      error: (...a: any[]) => console.error('[source]', ...a),
      info: (...a: any[]) => console.info('[source]', ...a),
      group: () => {},
      groupEnd: () => {},
    },
    setTimeout: safeSetTimeout,
    clearTimeout: safeClear,
    setInterval: safeSetInterval,
    clearInterval: safeClear,
    Buffer,
    URL,
    module: { exports: {} },
    exports: {},
    require: createRestrictedRequire(parentRequire),
  }
  sandbox.globalThis = sandbox
  sandbox.global = sandbox
  sandbox.globalThis.lx = lx
  sandbox.lx = lx

  const rejectionGuard = acquireSourceRejectionGuard()
  const script = new Script(code, { filename: localPath })
  const context = createContext(sandbox, { name: `miyin-source:${localPath}` })
  try {
    script.runInContext(context, { timeout: LOAD_TIMEOUT_MS, breakOnSigint: true })
  } catch (err: any) {
    for (const t of timers) safeClear(t)
    rejectionGuard.release()
    recordFailure(localPath)
    if (String(err?.message || err).includes('Script execution timed out')) {
      throw new Error('音源脚本初始化超时（疑似死循环）')
    }
    throw err
  }

  // 部分音源（如花）会先请求远端配置再异步 send(inited)
  if (!didInit) {
    const timedOut = await Promise.race([
      initPromise.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), INIT_WAIT_MS)),
    ])
    if (timedOut && !didInit) {
      rejectionGuard.release()
      failLoad(`音源初始化超时（${INIT_WAIT_MS}ms 内未发送 inited）`)
    }
  }

  if (!didInit) {
    rejectionGuard.release()
    failLoad('音源未完成初始化（未发送 inited）')
  }
  if (!handlers.length) {
    rejectionGuard.release()
    failLoad('音源未注册 musicUrl 处理函数')
  }
  if (!platforms.length) {
    platforms = ['wy', 'kw', 'kg', 'tx', 'mg']
    qualityMap = Object.fromEntries(platforms.map((p) => [p, ['128k', '320k']]))
  }

  async function getMusicUrl(platform: string, musicInfo: Record<string, any>, quality: string) {
    if (disposed) throw new Error('音源已释放')
    assertCircuitClosed(localPath)
    if (!handlers.length) throw new Error('音源未注册 musicUrl 处理函数')
    const info = { type: quality, musicInfo }
    const callGuard = acquireSourceRejectionGuard()
    try {
      const ret = await withTimeout(
        Promise.resolve().then(() => handlers[0]!({ action: 'musicUrl', source: platform, info })),
        CALL_TIMEOUT_MS,
        '取链',
      )
      let url: string | undefined
      if (typeof ret === 'string' && ret.startsWith('http')) url = ret
      else if (ret?.url) url = ret.url
      if (!url) throw new Error('未能获取播放地址')
      recordSuccess(localPath)
      return url
    } catch (err) {
      recordFailure(localPath)
      throw err
    } finally {
      holdSourceRejectionGuard(1500)
      callGuard.release()
    }
  }

  const handle: LxSourceHandle = {
    sourceKey: key,
    platforms,
    qualityMap,
    updateAlerts,
    getMusicUrl,
    dispose() {
      disposed = true
      handlers.length = 0
      for (const t of timers) safeClear(t)
      timers.clear()
      handleCache.delete(key)
    },
  }

  handleCache.set(key, { handle, mtimeMs: st.mtimeMs, loadedAt: Date.now() })
  // 覆盖脚本初始化后 fire-and-forget 的 checkUpdate
  holdSourceRejectionGuard(Number(process.env.MIYIN_SOURCE_UPDATE_GRACE_MS || 2500))
  rejectionGuard.release()
  return handle
}

/** 测试/运维：清空缓存与熔断 */
export function resetSourceRuntimeState() {
  for (const e of handleCache.values()) {
    try {
      e.handle.dispose()
    } catch {
      /* ignore */
    }
  }
  handleCache.clear()
  failCircuit.clear()
  resetSourceRejectionGuardForTests()
}

export function pickQuality(available: string[], preferred: string) {
  if (!available.length) return preferred === 'highest' ? '320k' : preferred
  if (preferred === 'highest') {
    const order = ['flac24bit', 'flac', '320k', '192k', '128k']
    for (const q of order) {
      if (available.includes(q)) return q
    }
    return available[available.length - 1]
  }
  if (available.includes(preferred)) return preferred
  return available[available.length - 1]
}

/** 供单测：在超时上下文中跑同步死循环应抛错 */
export function runSandboxedSync(code: string, timeoutMs = 100) {
  const context = createContext({})
  runInContext(code, context, { timeout: timeoutMs })
}
