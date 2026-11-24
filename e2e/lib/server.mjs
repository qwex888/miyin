// 隔离测试实例：复制数据 → 改写下载目录 → 起服务 → 等就绪 → 收尾。
//
// 为什么要隔离：E2E 会真实下载、改设置、启停音源。直接跑在 data/ 上会污染用户曲库，
// 跑在全新空库上又测不到「已在库 / 重复裁决」这类依赖存量数据的路径。
// 折中：用 VACUUM INTO 生成一致性快照，只把 downloadDir 指向临时目录。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { REPO_ROOT } from './config.mjs'

const require = createRequire(import.meta.url)

/** 端口是否空闲。 */
export function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.listen(port, '127.0.0.1')
  })
}

export async function findFreePort(start) {
  for (let p = start; p < start + 30; p++) {
    if (await portFree(p)) return p
  }
  throw new Error(`从 ${start} 起 30 个端口都被占用`)
}

/** 生成一致的数据库快照；源库不存在时返回 false（调用方走空库路径）。 */
function snapshotDb(srcDb, dstDb) {
  if (!fs.existsSync(srcDb)) return false
  try {
    const Database = require('better-sqlite3')
    const db = new Database(srcDb, { readonly: true })
    try {
      db.exec(`VACUUM INTO '${dstDb.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    return true
  } catch {
    // 兜底：直接复制（测试库，能读就行；不保证 WAL 内容完整）
    fs.copyFileSync(srcDb, dstDb)
    return true
  }
}

/** 把快照里的 downloadDir 指到临时目录，避免写进真实曲库。 */
function retargetDownloadDir(dbPath, downloadDir) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  try {
    const row = db.prepare("select value from settings where key = 'app'").get()
    if (!row?.value) return
    let app
    try {
      app = JSON.parse(row.value)
    } catch {
      return
    }
    app.downloadDir = downloadDir
    db.prepare("update settings set value = ? where key = 'app'").run(JSON.stringify(app))
  } finally {
    db.close()
  }
}

/**
 * 清掉库里的应用内口令覆盖。
 *
 * `auth_token_override` 的优先级**高于**环境变量，且「空字符串」表示刻意关闭鉴权。
 * 真实库里通常就是 `{"token":""}`，所以带快照起鉴权实例时，光传 AUTH_TOKEN 不起作用
 * ——必须先删掉这行覆盖，才会回到 env 路径。
 */
function resetAuthOverride(dbPath) {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    try {
      db.prepare("delete from settings where key = 'auth_token_override'").run()
    } finally {
      db.close()
    }
  } catch {
    /* 空库或表不存在：无需处理 */
  }
}

/**
 * 准备隔离数据目录。
 * @returns {{dataDir:string, downloadDir:string, seeded:boolean, root:string}}
 */
export function prepareDataDir({ root, seedFrom = path.join(REPO_ROOT, 'data'), resetAuth = false }) {
  const dataDir = path.join(root, 'data')
  const downloadDir = path.join(root, 'downloads')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(downloadDir, { recursive: true })

  const dstDb = path.join(dataDir, 'miyin.sqlite')
  const seeded = snapshotDb(path.join(seedFrom, 'miyin.sqlite'), dstDb)
  if (seeded) {
    retargetDownloadDir(dstDb, downloadDir)
    if (resetAuth) resetAuthOverride(dstDb)
  }

  // 音源脚本目录（自定义源）一并带过来，否则音源页可能是空的
  const srcSources = path.join(seedFrom, 'sources')
  if (fs.existsSync(srcSources)) {
    fs.cpSync(srcSources, path.join(dataDir, 'sources'), { recursive: true })
  }
  return { dataDir, downloadDir, seeded, root }
}

export function hasBuiltOutput() {
  return fs.existsSync(path.join(REPO_ROOT, '.output/server/index.mjs'))
}

/**
 * 启动一个服务实例。
 * @param {{port:number, root:string, authToken?:string, logFile?:string, disableWorker?:boolean}} o
 */
export async function startServer({ port, root, authToken = '', logFile = '', disableWorker = false }) {
  const { dataDir, downloadDir, seeded } = prepareDataDir({ root, resetAuth: Boolean(authToken) })
  const out = logFile ? fs.openSync(logFile, 'a') : 'ignore'
  const child = spawn(process.execPath, [path.join(REPO_ROOT, '.output/server/index.mjs')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      DOWNLOAD_DIR: downloadDir,
      AUTH_TOKEN: authToken,
      SESSION_SECRET: `e2e-${port}-${Date.now()}`,
      NODE_ENV: 'production',
      ...(disableWorker ? { MIYIN_DISABLE_WORKER: '1' } : {}),
    },
    stdio: ['ignore', out, out],
  })

  const base = `http://127.0.0.1:${port}`
  const ready = await waitReady(base, 40000)
  if (!ready) {
    child.kill('SIGKILL')
    throw new Error(`服务在 40s 内未就绪：${base}${logFile ? `（日志 ${logFile}）` : ''}`)
  }
  return {
    base,
    port,
    dataDir,
    downloadDir,
    seeded,
    root,
    child,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      const ok = await Promise.race([
        new Promise((r) => child.once('exit', () => r(true))),
        new Promise((r) => setTimeout(() => r(false), 4000)),
      ])
      if (!ok) child.kill('SIGKILL')
    },
  }
}

async function waitReady(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) })
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** 建一个本次运行专用的临时根目录。 */
export function makeRunRoot(tag) {
  const dir = path.join(os.tmpdir(), `miyin-e2e-${tag}-${Date.now().toString(36)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
