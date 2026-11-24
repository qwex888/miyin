#!/usr/bin/env node
// 觅音 E2E 真实 UI 测试入口。
//
//   pnpm test:e2e                          # PC + 移动端全量
//   pnpm test:e2e --only=smoke,queue       # 只跑指定模块
//   pnpm test:e2e --profile=mobile         # 只跑移动端
//   pnpm test:e2e --headed                 # 有头模式排障
//   pnpm test:e2e --base=http://127.0.0.1:18980   # 复用已启动的服务
//   pnpm test:e2e --list                   # 列出模块
//
// 详见 e2e/README.md。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cli, env, REPO_ROOT, selectedProfiles } from './lib/config.mjs'
import { launchBrowser, newPage } from './lib/browser.mjs'
import { createRecorder, writeReports, repoSha } from './lib/report.mjs'
import { findFreePort, hasBuiltOutput, makeRunRoot, startServer } from './lib/server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SPEC_DIR = path.join(HERE, 'specs')

/** 载入并排序所有 spec。 */
async function loadSpecs() {
  const files = fs
    .readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
  const specs = []
  for (const f of files) {
    const mod = await import(path.join(SPEC_DIR, f))
    if (!mod.meta || typeof mod.default !== 'function') {
      console.warn(`[e2e] 跳过 ${f}：缺少 meta 或 default 导出`)
      continue
    }
    specs.push({ file: f, meta: mod.meta, run: mod.default })
  }
  return specs.sort((a, b) => a.meta.order - b.meta.order)
}

function apiClient(base) {
  const call = async (method, p, body) => {
    const r = await fetch(base + p, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应 */
    }
    return { status: r.status, json, text }
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw: async (p) => {
      const r = await fetch(base + p, { signal: AbortSignal.timeout(15000) })
      return { status: r.status, text: await r.text() }
    },
  }
}

async function main() {
  const t0 = Date.now()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportDir = path.join(env.reportDir, stamp)
  const shotsDir = path.join(reportDir, 'shots')
  fs.mkdirSync(shotsDir, { recursive: true })

  const specs = await loadSpecs()

  if (cli.list) {
    console.log('可用模块（--only=tag）：\n')
    for (const s of specs) {
      console.log(`  ${s.meta.tag.padEnd(12)} ${s.meta.title.padEnd(12)} order=${String(s.meta.order).padStart(3)}  profiles=${s.meta.profiles.join(',')}`)
    }
    console.log('\n单条用例 ID 在运行时生成，格式 E2E-<模块>-<序号>；报告见 e2e/reports/<时间戳>/report.md')
    return 0
  }

  const wanted = cli.only.length ? new Set(cli.only) : null
  const picked = specs.filter((s) => !wanted || wanted.has(s.meta.tag))
  if (!picked.length) {
    console.error(`[e2e] 没有匹配的模块。可用：${specs.map((s) => s.meta.tag).join(', ')}`)
    return 1
  }

  const profiles = selectedProfiles()
  const git = repoSha()
  let server = null
  let runRoot = ''
  let base = cli.base

  // 需要真实网络与下载的模块要求 .output 已构建
  if (!base) {
    if (!hasBuiltOutput()) {
      console.error('[e2e] 缺少 .output/server/index.mjs。先构建：pnpm build')
      return 1
    }
    runRoot = makeRunRoot('main')
    const port = await findFreePort(env.port)
    console.log(`[e2e] 启动隔离实例 :${port}（数据快照 → ${runRoot}）`)
    server = await startServer({
      port,
      root: path.join(runRoot, 'main'),
      authToken: env.authToken,
      logFile: path.join(reportDir, 'server-main.log'),
    })
    base = server.base
    console.log(`[e2e] 就绪 ${base}${server.seeded ? '（已带入快照数据）' : '（空库）'}`)
  } else {
    console.log(`[e2e] 复用外部服务 ${base}`)
  }

  const { browser, label: browserLabel } = await launchBrowser({ headed: cli.headed })
  console.log(`[e2e] 浏览器 ${browserLabel}`)

  const profileResults = []
  let failed = 0

  try {
    for (const profile of profiles) {
      const todo = picked.filter((s) => s.meta.profiles.includes(profile.name) && !s.meta.singleRun)
      if (!todo.length) continue
      console.log(`\n===== ${profile.name.toUpperCase()} ${profile.viewport.width}x${profile.viewport.height} =====`)
      const rec = createRecorder({ profile: profile.name, base })
      const state = {}

      for (const spec of todo) {
        console.log(`\n-- ${spec.meta.tag} · ${spec.meta.title} --`)
        // 每个模块独立 context：模块之间只通过 state 传数据，不共享页面状态。
        // 共享 page 会让「上一个模块留下的详情面板/弹窗」变成下一个模块的假失败。
        const { ctx, page } = await newPage(browser, profile)
        rec.attach(page, shotsDir)
        const c = {
          base,
          profile: profile.name,
          isMobile: profile.isMobile,
          page,
          api: apiClient(base),
          keyword: env.keyword,
          maxDownloads: env.maxDownloads,
          downloadTimeoutMs: env.downloadTimeoutMs,
          authToken: env.authToken,
          state,
        }
        try {
          await spec.run(rec, c)
        } catch (e) {
          rec.skip(`E2E-${spec.meta.tag.toUpperCase()}-ERR`, spec.meta.title, `模块异常中断：${String(e.message).split('\n')[0]}`)
        }
        await ctx.close().catch(() => {})
        if (cli.bail && rec.cases.some((x) => x.status === 'fail')) break
      }

      const s = rec.summary()
      failed += s.fail
      profileResults.push({ profile: profile.name, cases: rec.cases, summary: s, diag: rec.diag })
      console.log(`\n[e2e] ${profile.name}: ${s.pass}/${s.total} 通过${s.fail ? `，${s.fail} 失败` : ''}`)
      if (cli.bail && failed > 0) break
    }

    // ---- 鉴权模块：独立实例，只跑一次 ----
    const authSpec = picked.find((s) => s.meta.needsAuthServer)
    if (authSpec && !(cli.bail && failed > 0)) {
      console.log(`\n===== AUTH（独立鉴权实例）=====`)
      const rec = createRecorder({ profile: 'pc', base: '(独立实例)' })
      let authServer = null
      try {
        if (cli.base) {
          // 复用模式下必须由调用方提供已开鉴权的地址
          if (!env.authToken) throw new Error('--base 模式下跑 auth 需设置 E2E_AUTH_TOKEN')
          const probe = await fetch(cli.base + '/api/settings')
          if (probe.status !== 401) throw new Error(`外部服务未开启鉴权（/api/settings=${probe.status}）`)
          Object.assign(rec, {})
          rec.skip('E2E-AUTH-00', '鉴权链路', '复用模式只做连通性校验，完整登录流程需自建实例')
        } else {
          const port = await findFreePort(env.port + 20)
          authServer = await startServer({
            port,
            root: path.join(runRoot, 'auth'),
            authToken: env.authProbeToken,
            logFile: path.join(reportDir, 'server-auth.log'),
            disableWorker: true, // 鉴权链路不需要下载 worker
          })
          const p = await newPage(browser, { name: 'pc', viewport: { width: 1440, height: 900 }, isMobile: false, deviceScaleFactor: 1 })
          rec.attach(p.page, shotsDir)
          await authSpec.run(rec, {
            base: authServer.base,
            profile: 'pc',
            isMobile: false,
            page: p.page,
            api: apiClient(authServer.base),
            keyword: env.keyword,
            maxDownloads: 0,
            downloadTimeoutMs: env.downloadTimeoutMs,
            authToken: env.authProbeToken,
            state: {},
          })
          await p.ctx.close()
        }
      } catch (e) {
        rec.skip('E2E-AUTH-00', '鉴权链路', String(e.message).split('\n')[0])
      } finally {
        if (authServer) await authServer.stop()
      }
      const s = rec.summary()
      failed += s.fail
      profileResults.push({ profile: 'auth', cases: rec.cases, summary: s, diag: rec.diag })
      console.log(`\n[e2e] auth: ${s.pass}/${s.total} 通过${s.fail ? `，${s.fail} 失败` : ''}`)
    }
  } finally {
    await browser.close().catch(() => {})
    if (server) await server.stop()
  }

  const report = writeReports({
    dir: reportDir,
    profiles: profileResults,
    meta: {
      git,
      base,
      browser: browserLabel,
      buildTime: fs.existsSync(path.join(REPO_ROOT, '.output/server/index.mjs'))
        ? fs.statSync(path.join(REPO_ROOT, '.output/server/index.mjs')).mtime.toISOString()
        : '',
      command: process.argv.slice(2).join(' '),
      keyword: env.keyword,
    },
  })

  const total = profileResults.reduce((n, p) => n + p.summary.total, 0)
  const pass = profileResults.reduce((n, p) => n + p.summary.pass, 0)
  const skip = profileResults.reduce((n, p) => n + p.summary.skipped, 0)

  console.log('\n===== 汇总 =====')
  console.log(`用例 ${total}：PASS ${pass} / FAIL ${failed} / SKIP ${skip}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (failed) {
    for (const p of profileResults) {
      for (const c of p.cases.filter((x) => x.status === 'fail')) {
        console.log(` - [${p.profile}] ${c.id} ${c.name} :: ${c.detail}`)
      }
    }
  }
  console.log(`报告：${report.file}`)

  if (!cli.keep && runRoot) {
    fs.rmSync(runRoot, { recursive: true, force: true })
  }
  return failed > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[e2e] 运行失败：', e?.stack || e)
    process.exit(2)
  })
