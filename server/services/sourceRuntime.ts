import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script, createContext } from 'node:vm'
import { request as httpRequest } from 'node:https'
import { request as httpRequestPlain } from 'node:http'
import { URL } from 'node:url'

export type LxSourceHandle = {
  platforms: string[]
  qualityMap: Record<string, string[]>
  getMusicUrl: (platform: string, musicInfo: Record<string, any>, quality: string) => Promise<string>
  dispose: () => void
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
        timeout: 20000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
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

/**
 * 加载洛雪兼容音源脚本（提供 globalThis.lx 沙箱）
 */
export function loadLxSource(localPath: string): LxSourceHandle {
  const code = readFileSync(localPath, 'utf8')
  const handlers: Array<(payload: any) => any> = []
  let platforms: string[] = []
  let qualityMap: Record<string, string[]> = {}
  let inited = false

  const EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
  }

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
        inited = !!payload?.status
        const sources = payload?.sources || payload?.init?.sources || {}
        // juhe 可能直接传 init 结构
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
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    module: { exports: {} },
    exports: {},
    require: createRequire(import.meta.url),
  }
  sandbox.globalThis = sandbox
  sandbox.global = sandbox
  sandbox.globalThis.lx = lx
  sandbox.lx = lx

  const script = new Script(code, { filename: localPath })
  const context = createContext(sandbox)
  script.runInContext(context, { timeout: 8000 })

  void inited
  if (!platforms.length) {
    platforms = ['wy', 'kw', 'kg', 'tx', 'mg']
    qualityMap = Object.fromEntries(platforms.map((p) => [p, ['128k', '320k']]))
  }

  async function getMusicUrl(platform: string, musicInfo: Record<string, any>, quality: string) {
    if (!handlers.length) throw new Error('音源未注册 musicUrl 处理函数')
    const info = { type: quality, musicInfo }
    const ret = await Promise.resolve(handlers[0]!({ action: 'musicUrl', source: platform, info }))
    if (typeof ret === 'string' && ret.startsWith('http')) return ret
    if (ret?.url) return ret.url
    throw new Error('未能获取播放地址')
  }

  return {
    platforms,
    qualityMap,
    getMusicUrl,
    dispose() {
      handlers.length = 0
    },
  }
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
