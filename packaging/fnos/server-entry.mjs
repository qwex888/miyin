#!/usr/bin/env node
/**
 * 飞牛 Native 入口：Nitro 监听本机 TCP，Unix Socket 反向代理到网关。
 * 当前 Nuxt/Nitro 运行时未稳定暴露 NITRO_UNIX_SOCKET，故用此包装。
 * better-sqlite3@13+ 通过包内 prebuilds/ 按 platform+arch 自动加载（胖包双架构）。
 */
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOCKET_PATH = process.env.SOCKET_PATH || process.env.NITRO_UNIX_SOCKET || ''
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || process.env.NITRO_PORT || 18980)
const SERVER_ENTRY = join(__dirname, '.output', 'server', 'index.mjs')

function waitPort(host, port, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host, port }, () => {
        sock.end()
        resolve(true)
      })
      sock.on('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`等待 Nitro 端口 ${port} 超时`))
        else setTimeout(tryOnce, 200)
      })
    }
    tryOnce()
  })
}

function startProxy(socketPath, port) {
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {
      /* ignore */
    }
  }
  mkdirSync(dirname(socketPath), { recursive: true })

  const proxy = createHttpServer((req, res) => {
    const headers = { ...req.headers, host: `${HOST}:${port}` }
    const upstream = httpRequest(
      {
        host: HOST,
        port,
        path: req.url,
        method: req.method,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (err) => {
      res.statusCode = 502
      res.end(String(err?.message || err))
    })
    req.pipe(upstream)
  })

  proxy.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o777)
    } catch {
      /* ignore */
    }
    console.log(`[miyin] gateway socket listening: ${socketPath} -> ${HOST}:${port}`)
  })

  return proxy
}

if (!existsSync(SERVER_ENTRY)) {
  console.error(`[miyin] missing ${SERVER_ENTRY}, run build first`)
  process.exit(1)
}

const child = spawn(process.execPath, [SERVER_ENTRY], {
  cwd: __dirname,
  env: {
    ...process.env,
    HOST,
    PORT: String(PORT),
    NITRO_HOST: HOST,
    NITRO_PORT: String(PORT),
    NODE_ENV: 'production',
  },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  console.error(`[miyin] nitro exited code=${code} signal=${signal}`)
  process.exit(code || 1)
})

async function main() {
  await waitPort(HOST, PORT)
  if (SOCKET_PATH) {
    startProxy(SOCKET_PATH, PORT)
  } else {
    console.log(`[miyin] no SOCKET_PATH, nitro only on http://${HOST}:${PORT}`)
  }
}

main().catch((err) => {
  console.error(err)
  child.kill('SIGTERM')
  process.exit(1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill('SIGTERM')
    if (SOCKET_PATH && existsSync(SOCKET_PATH)) {
      try {
        unlinkSync(SOCKET_PATH)
      } catch {
        /* ignore */
      }
    }
    process.exit(0)
  })
}
