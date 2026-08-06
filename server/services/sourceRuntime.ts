import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script, createContext, runInContext } from 'node:vm'
import { request as httpRequest } from 'node:https'
import { request as httpRequestPlain } from 'node:http'
import { URL } from 'node:url'

export type LxSourceHandle = {
  platforms: string[]
  qualityMap: Record<string, string[]>
  getMusicUrl: (platform: string, musicInfo: Record<string, any>, quality: string) => Promise<string>
  dispose: () => void
  sourceKey: string
}

const LOAD_TIMEOUT_MS = Number(process.env.MIYIN_SOURCE_LOAD_TIMEOUT_MS || 5000)
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

function nodeHttpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: any },
  cb: (err: any, resp?: { statusCode: number; body: any; headers: any }) => void,
) {
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
            cb(new Error('音源响应体过大'))
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
          cb(null, { statusCode: res.statusCode || 0, body, headers: res.headers })
        })
      },
    )
    req.on('error', (err) => cb(err))
    req.on('timeout', () => {
      req.destroy()
      cb(new Error('request timeout'))
    })
    if (payload) req.write(payload)
    req.end()
  } catch (err) {
    cb(err)
  }
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

/**
 * 加载洛雪兼容音源脚本（提供 globalThis.lx 沙箱）
 * - 同步执行带 timeout，防止死循环
 * - 定时器数量上限，dispose 时清理
 * - getMusicUrl 带 Promise 超时
 * - 按路径+mtime 缓存，连续失败熔断
 */
export function loadLxSource(localPath: string, opts?: { bypassCache?: boolean }): LxSourceHandle {
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
  let platforms: string[] = []
  let qualityMap: Record<string, string[]> = {}
  let disposed = false
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

  const parentRequire = createRequire(import.meta.url)
  const lx = {
    EVENT_NAMES,
    env: 'desktop',
    version: '2.0.0',
    utils: {
      buffer: {
        from: (...args: any[]) => Buffer.from(...(args as [any])),
        bufToString: (buf: Buffer, encoding?: BufferEncoding) => buf.toString(encoding || 'utf8'),
      },
      crypto: {
        md5: (s: string) => createHash('md5').update(String(s)).digest('hex'),
      },
    },
    request: nodeHttpRequest,
    on(name: string, fn: (payload: any) => any) {
      if (name === EVENT_NAMES.request) handlers.push(fn)
    },
    send(name: string, payload: any) {
      if (name === EVENT_NAMES.inited) {
        const sources = payload?.sources || payload?.init?.sources || {}
        const srcObj = sources.sources || sources
        platforms = Object.keys(srcObj || {})
        qualityMap = {}
        for (const [k, v] of Object.entries(srcObj || {}) as Array<[string, any]>) {
          qualityMap[k] = v?.qualitys || ['128k']
        }
        if (payload?.init?.sources) {
          platforms = Object.keys(payload.init.sources)
          for (const [k, v] of Object.entries(payload.init.sources) as Array<[string, any]>) {
            qualityMap[k] = v?.qualitys || ['128k']
          }
        }
      }
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

  const script = new Script(code, { filename: localPath })
  const context = createContext(sandbox, { name: `miyin-source:${localPath}` })
  try {
    script.runInContext(context, { timeout: LOAD_TIMEOUT_MS, breakOnSigint: true })
  } catch (err: any) {
    for (const t of timers) safeClear(t)
    recordFailure(localPath)
    if (String(err?.message || err).includes('Script execution timed out')) {
      throw new Error('音源脚本初始化超时（疑似死循环）')
    }
    throw err
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
    }
  }

  const handle: LxSourceHandle = {
    sourceKey: key,
    platforms,
    qualityMap,
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
}

export function pickQuality(available: string[], preferred: string) {
  if (!available.length) return preferred === 'highest' ? '320k' : preferred
  if (preferred === 'highest') {
    const order = ['flac', '320k', '192k', '128k']
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
