// E2E 运行配置：全部来自环境变量 + 命令行，默认值保证「零参数可跑」。
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '../..')

/** 解析 `--key=value` / `--flag` 形式的 argv。 */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {}
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue
    const body = raw.slice(2)
    const eq = body.indexOf('=')
    if (eq === -1) out[body] = true
    else out[body.slice(0, eq)] = body.slice(eq + 1)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

export const cli = {
  /** 只跑这些 tag 的 spec，逗号分隔；空 = 全部 */
  only: typeof args.only === 'string' ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : [],
  /** pc / mobile / both */
  profile: typeof args.profile === 'string' ? args.profile : 'both',
  /** 复用已在跑的服务，不再拉起隔离实例（CI 或本地手动起服时用） */
  base: typeof args.base === 'string' ? args.base.replace(/\/$/, '') : '',
  /** 有头模式，排障用 */
  headed: args.headed === true,
  /** 只列用例不执行 */
  list: args.list === true,
  /** 失败即停 */
  bail: args.bail === true,
  /** 保留临时数据目录（默认跑完删） */
  keep: args.keep === true,
}

export const env = {
  /** 隔离实例监听端口；被占用会自动 +1 重试 */
  port: Number(process.env.E2E_PORT || 18990),
  /** 校验/登录用口令；留空则主实例关闭鉴权（与被测产品默认行为一致） */
  authToken: process.env.E2E_AUTH_TOKEN || '',
  /** 鉴权 spec 专用口令 */
  authProbeToken: process.env.E2E_AUTH_PROBE_TOKEN || 'e2e-probe-pass',
  /** 浏览器：优先 channel（本机 Chrome），失败回落 chromium 自带 */
  channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
  /** 搜索关键词；上游波动时可换一个常见歌手 */
  keyword: process.env.E2E_SEARCH_KEYWORD || '周杰伦',
  /** 每个 profile 最多真实入队几首（控制网络用量与上游压力） */
  maxDownloads: Number(process.env.E2E_MAX_DOWNLOADS || 1),
  /** 等待单个下载完成的上限 */
  downloadTimeoutMs: Number(process.env.E2E_DOWNLOAD_TIMEOUT_MS || 180000),
  /** 报告根目录 */
  reportDir: process.env.E2E_REPORT_DIR || path.join(REPO_ROOT, 'e2e/reports'),
  /** 显式指定 playwright 包路径（自动探测失败时用） */
  playwrightPath: process.env.PLAYWRIGHT_PATH || '',
}

export const PROFILES = {
  pc: { name: 'pc', viewport: { width: 1440, height: 900 }, isMobile: false, deviceScaleFactor: 1 },
  mobile: { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 3 },
}

/** @returns {Array<{name:string,viewport:{width:number,height:number},isMobile:boolean,deviceScaleFactor:number}>} */
export function selectedProfiles() {
  if (cli.profile === 'both') return [PROFILES.pc, PROFILES.mobile]
  const p = PROFILES[cli.profile]
  if (!p) throw new Error(`--profile 只能是 pc / mobile / both，收到 ${cli.profile}`)
  return [p]
}
