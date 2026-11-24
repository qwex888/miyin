// 用例记录器 + 报告输出（JSON 给机器，Markdown 给人/AI）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { REPO_ROOT } from './config.mjs'

/** 截断长文本，报告里只留可判断的部分。 */
export const short = (v, n = 160) => {
  const raw = v && typeof v === 'object' && 'message' in v ? v.message : v
  const s = String(raw ?? '')
    .split('\n')[0]
    .trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * 用例记录器。
 *
 * 设计目标：每条用例有**稳定 ID**（跨版本可比）、**级别**（决定发版门槛）、
 * **耗时**与**证据截图**，且单条用例抛错不会中断整个 spec。
 */
export function createRecorder({ profile, base, startedAt = Date.now() }) {
  const cases = []
  const diag = { console: [], pageerror: [], requestfailed: [], hydration: [] }
  let phase = 'init'
  let seq = 0
  let shotsDir = ''

  function setPhase(p) {
    phase = p
  }

  function attach(page, shots) {
    shotsDir = shots
    page.on('console', (m) => {
      const t = m.text()
      if (/[Hh]ydration|mismatch/i.test(t)) diag.hydration.push(`${phase}: ${t.slice(0, 300)}`)
      if (m.type() === 'error') diag.console.push(`${phase}: ${t.slice(0, 300)}`)
    })
    page.on('pageerror', (e) => diag.pageerror.push(`${phase}: ${e.message.slice(0, 300)}`))
    page.on('requestfailed', (r) => {
      const u = r.url()
      if (/favicon|\.map$/.test(u)) return
      diag.requestfailed.push(`${phase}: ${r.method()} ${u.replace(base, '')} ${r.failure()?.errorText}`)
    })
  }

  /**
   * 执行一条用例。
   * @param {string} id 稳定 ID，如 E2E-SEARCH-03
   * @param {string} name 人类可读名称
   * @param {() => Promise<string|void|{detail?:string}>} fn 断言体；抛错即失败
   * @param {{severity?:'P0'|'P1'|'P2', evidence?:string[]}} [opts]
   */
  async function assert(id, name, fn, opts = {}) {
    const t0 = Date.now()
    let status = 'pass'
    let detail = ''
    let error = ''
    try {
      const r = await fn()
      if (typeof r === 'string') detail = r
      else if (r && typeof r === 'object' && r.detail) detail = r.detail
    } catch (e) {
      status = 'fail'
      // Playwright 的超时错误关键信息在第二三行（waiting for locator / element is not enabled），
      // 只取首行会丢掉"到底是哪个元素"，所以这里压掉换行而不是截断。
      error = String(e?.message || e)
        .replace(/\s*\n\s*/g, ' ⏎ ')
        .slice(0, 240)
      detail = error
    }
    const rec = {
      id,
      name,
      severity: opts.severity || 'P1',
      status,
      ms: Date.now() - t0,
      detail,
      error,
      evidence: opts.evidence || [],
    }
    cases.push(rec)
    const icon = status === 'pass' ? 'PASS' : 'FAIL'
    console.log(`  ${icon} ${id} ${name}${detail ? ` | ${detail}` : ''}`)
    return status === 'pass'
  }

  function skip(id, name, reason) {
    cases.push({ id, name, severity: 'P2', status: 'skip', ms: 0, detail: reason, error: '', evidence: [] })
    console.log(`  SKIP ${id} ${name} | ${reason}`)
  }

  async function shot(page, tag) {
    if (!shotsDir) return ''
    const f = path.join(shotsDir, `${profile}-${String(++seq).padStart(2, '0')}-${tag}.png`)
    try {
      await page.screenshot({ path: f, fullPage: false })
      return f
    } catch {
      return ''
    }
  }

  function summary() {
    const pass = cases.filter((c) => c.status === 'pass').length
    const fail = cases.filter((c) => c.status === 'fail').length
    const skipped = cases.filter((c) => c.status === 'skip').length
    const blocking = cases.filter((c) => c.status === 'fail' && c.severity === 'P0').length
    return { total: cases.length, pass, fail, skipped, blocking, ms: Date.now() - startedAt }
  }

  return { cases, diag, assert, skip, shot, setPhase, attach, summary }
}

/** 读取当前 git 版本信息，写进报告便于对照。 */
export function repoSha() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    return { sha, branch }
  } catch {
    return { sha: 'unknown', branch: 'unknown' }
  }
}

/**
 * 落盘报告。
 * @param {object} o
 * @param {string} o.dir 报告目录
 * @param {Array} o.profiles 本次跑过的 profile 结果
 * @param {object} o.meta 环境信息
 */
export function writeReports({ dir, profiles, meta }) {
  fs.mkdirSync(dir, { recursive: true })
  const all = profiles.flatMap((p) => p.cases.map((c) => ({ ...c, profile: p.profile })))
  const pass = all.filter((c) => c.status === 'pass').length
  const fail = all.filter((c) => c.status === 'fail').length
  const skipped = all.filter((c) => c.status === 'skip').length

  const json = {
    generatedAt: new Date().toISOString(),
    ...meta,
    totals: { total: all.length, pass, fail, skipped },
    profiles: profiles.map((p) => ({ profile: p.profile, summary: p.summary, diag: p.diag })),
    cases: all,
  }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(json, null, 2))

  const md = renderMarkdown(json)
  fs.writeFileSync(path.join(dir, 'report.md'), md)
  return { json, md, file: path.join(dir, 'report.md') }
}

function renderMarkdown(r) {
  const lines = []
  lines.push('# 觅音 E2E 实测报告', '')
  lines.push(`- 生成时间：${r.generatedAt}`)
  lines.push(`- 版本：\`${r.git.sha}\`（${r.git.branch}）`)
  lines.push(`- 服务：${r.base}`)
  lines.push(`- 浏览器：${r.browser}`)
  lines.push(`- 产物构建时间：${r.buildTime || '未探测'}`)
  lines.push('')
  lines.push('## 总览', '')
  lines.push('| 总数 | PASS | FAIL | SKIP |', '|---|---|---|---|')
  lines.push(`| ${r.totals.total} | ${r.totals.pass} | ${r.totals.fail} | ${r.totals.skipped} |`, '')

  const failures = r.cases.filter((c) => c.status === 'fail')
  if (failures.length) {
    lines.push('## 失败用例', '')
    lines.push('| ID | 级别 | 端 | 名称 | 详情 |', '|---|---|---|---|---|')
    for (const c of failures) {
      lines.push(`| ${c.id} | ${c.severity} | ${c.profile} | ${c.name} | ${esc(c.detail)} |`)
    }
    lines.push('')
  }

  for (const p of r.profiles) {
    lines.push(`## ${p.profile === 'pc' ? 'PC 端' : '移动端'}（${p.profile}）`, '')
    lines.push('| ID | 名称 | 级别 | 结果 | 耗时 | 详情 |', '|---|---|---|---|---|---|')
    for (const c of r.cases.filter((x) => x.profile === p.profile)) {
      const status = c.status === 'pass' ? '✅' : c.status === 'skip' ? '⏭️' : '❌'
      lines.push(`| ${c.id} | ${c.name} | ${c.severity} | ${status} | ${c.ms}ms | ${esc(c.detail)} |`)
    }
    lines.push('')
    const d = p.diag
    const noise = (arr) =>
      arr.filter((t) => !/favicon|ResizeObserver|Failed to load resource.*401/.test(t))
    const bits = [
      ['控制台 error', noise(d.console)],
      ['未捕获异常', noise(d.pageerror)],
      ['失败请求', noise(d.requestfailed)],
      ['水合告警', d.hydration],
    ].filter(([, arr]) => arr.length)
    if (bits.length) {
      lines.push('**诊断信息**', '')
      for (const [label, arr] of bits) {
        lines.push(`- ${label}（${arr.length}）：`)
        for (const t of arr.slice(0, 5)) lines.push(`  - \`${esc(t)}\``)
      }
      lines.push('')
    }
  }

  lines.push('---', '', '复现单条：`pnpm test:e2e --only=<tag> --profile=pc --headed`', '')
  return lines.join('\n')
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
