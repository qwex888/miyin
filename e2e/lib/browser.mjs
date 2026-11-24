// Playwright 定位与浏览器启动。
//
// 仓库**没有**把 playwright 作为依赖（它体积大、且只在需要真实 UI 时才用），
// 所以这里按可预期顺序探测，并在全都没找到时给出可直接复制的安装命令。
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)

/** 候选路径：显式指定 → 项目依赖 → 全局 npm → WorkBuddy 内置 CLI。 */
function candidates() {
  const list = []
  if (process.env.PLAYWRIGHT_PATH) list.push(process.env.PLAYWRIGHT_PATH)
  list.push('playwright', 'playwright-core')
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    if (root) {
      list.push(path.join(root, 'playwright'))
      list.push(path.join(root, 'playwright-core'))
      list.push(path.join(root, '@playwright/cli/node_modules/playwright'))
    }
  } catch {
    /* npm 不可用时跳过 */
  }
  // WorkBuddy 内置 CLI 的自带副本（本机常用）
  const hb = path.join(os.homedir(), '.workbuddy/binaries')
  list.push(path.join(hb, 'node/versions/22.22.2-6/lib/node_modules/@playwright/cli/node_modules/playwright'))
  return list
}

/** @returns {import('playwright').BrowserType} */
export function resolvePlaywright() {
  for (const c of candidates()) {
    try {
      const mod = require(c)
      if (mod?.chromium) return mod.chromium
    } catch {
      /* 继续下一个 */
    }
  }
  throw new Error(
    [
      '未找到 playwright。任选一种方式安装后重跑：',
      '  pnpm add -D playwright && pnpm exec playwright install chromium',
      '  # 或全局：npm i -g playwright',
      '  # 或用已有副本：PLAYWRIGHT_PATH=/path/to/playwright pnpm test:e2e',
    ].join('\n'),
  )
}

export const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

/**
 * 启动浏览器。优先用系统 Chrome（channel），失败再回落自带 chromium——
 * 本机实测：自带 chromium 在无头下会出现 Broker 断连，系统 Chrome 稳定。
 */
export async function launchBrowser({ headed = false } = {}) {
  const chromium = resolvePlaywright()
  const wantChannel = process.env.E2E_BROWSER_CHANNEL || 'chrome'
  const attempts = []
  if (wantChannel) attempts.push({ channel: wantChannel })
  attempts.push({})
  let lastErr
  for (const opt of attempts) {
    try {
      const browser = await chromium.launch({ ...opt, args: LAUNCH_ARGS, headless: !headed })
      const label = opt.channel ? `${opt.channel}（系统安装）` : 'bundled chromium'
      return { browser, label }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

export async function newPage(browser, profile) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    deviceScaleFactor: profile.deviceScaleFactor,
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  return { ctx, page }
}
