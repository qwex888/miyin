// E2E-AUTH：鉴权链路 —— 未登录拦截、登录、错误口令限流、退出失效。
//
// 需要**独立实例**（AUTH_TOKEN 非空），由 run.mjs 单独拉起；
// 限流是进程内状态，所以本组只跑一次（不按 pc/mobile 重复）。
import { sel, api as apiPath } from '../selectors.mjs'

export const meta = {
  tag: 'auth',
  title: '鉴权链路',
  order: 100,
  profiles: ['pc'],
  singleRun: true,
  needsAuthServer: true,
  /** 限流会把该实例锁一段时间，跑完直接丢弃这个实例 */
  throwawayServer: true,
}

export default async function run(t, ctx) {
  const { page, base, authToken, api } = ctx
  t.setPhase('/auth')

  // 登录请求的状态码序列：限流最终表现为 429，比抓 toast 文案稳定
  // （提示条会 2~3s 自动消失，抓不到时会误判成"没限流"）。
  const loginCodes = []
  page.on('response', (r) => {
    if (r.url().includes(apiPath.authLogin)) loginCodes.push(r.status())
  })

  // ---- 接口层：未登录拦截 ----
  await t.assert(
    'E2E-AUTH-01',
    '未登录访问受保护接口返回 401',
    async () => {
      const probes = ['/api/settings', '/api/downloads', '/api/sources']
      const bad = []
      for (const p of probes) {
        const r = await api.raw(p)
        if (r.status !== 401) bad.push(`${p}=${r.status}`)
      }
      if (bad.length) throw new Error(bad.join(' '))
      return probes.map((p) => `${p}=401`).join(' ')
    },
    { severity: 'P0' },
  )

  // ---- UI：未登录跳登录页 ----
  await t.assert(
    'E2E-AUTH-02',
    '未登录访问首页被重定向到登录页',
    async () => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      if (!page.url().includes('/login')) throw new Error(`仍在 ${page.url().replace(base, '')}`)
      if (!(await page.locator(sel.loginPassword).isVisible().catch(() => false))) throw new Error('登录页无口令输入框')
      await t.shot(page, 'login')
      return page.url().replace(base, '')
    },
    { severity: 'P0' },
  )

  // ---- 错误口令提示 ----
  await t.assert(
    'E2E-AUTH-03',
    '错误口令有明确提示',
    async () => {
      await page.locator(sel.loginPassword).first().fill('e2e-wrong-1')
      await page.locator(sel.loginSubmit).first().click()
      await page.waitForTimeout(1500)
      const body = await page.locator('body').innerText()
      const line = body.split('\n').map((s) => s.trim()).find((s) => /错误|不正确|失败/.test(s))
      if (!line) throw new Error(`未见错误提示：${body.replace(/\n+/g, ' ').slice(0, 80)}`)
      return line.slice(0, 40)
    },
    { severity: 'P1' },
  )

  // ---- 连续错误触发限流 ----
  await t.assert(
    'E2E-AUTH-04',
    '连续错误口令触发退避限流（429）',
    async () => {
      let toast = ''
      // 退避规则：连续失败 >3 次后，每次失败都会把 nextAttemptAt 推后 1s→2s→4s…
      // 间隔必须小于当时的退避窗口才会被 429，所以这里用 800ms 快节奏重试
      // （间隔 2s 以上会永远「刚好赶上放行」，看不到限流，属测试设计错误而非产品缺陷）。
      for (let i = 2; i <= 8; i++) {
        await page.locator(sel.loginPassword).first().fill(`e2e-wrong-${i}`)
        await page.locator(sel.loginSubmit).first().click()
        await page.waitForTimeout(800)
        // 顺带记录是否给出了可读提示（产品体验，非阻塞判据）
        const body = await page.locator('body').innerText()
        const hit = body.split('\n').map((s) => s.trim()).find((s) => /频繁|过多|秒后|分钟/.test(s))
        if (hit && !toast) toast = hit
        if (loginCodes.includes(429)) break
      }
      await t.shot(page, 'throttle')
      if (!loginCodes.includes(429)) {
        throw new Error(`6 次错误未出现 429，状态码序列=${loginCodes.join(',')}`)
      }
      const first429 = loginCodes.indexOf(429) + 1
      return `第 ${first429} 次起 429 · 序列 ${loginCodes.join(',')}${toast ? ` · 提示「${toast.slice(0, 20)}」` : ' · 无可见提示（体验项）'}`
    },
    { severity: 'P0' },
  )

  // ---- 冷却后登录成功 ----
  await t.assert(
    'E2E-AUTH-05',
    '冷却后用正确口令登录成功',
    async () => {
      await page.waitForTimeout(12000)
      await page.locator(sel.loginPassword).first().fill(authToken)
      await page.locator(sel.loginSubmit).first().click()
      await page.waitForTimeout(3000)
      if (page.url().includes('/login')) {
        // 可能仍在退避窗口内，再等一轮
        await page.waitForTimeout(8000)
        await page.locator(sel.loginPassword).first().fill(authToken)
        await page.locator(sel.loginSubmit).first().click()
        await page.waitForTimeout(3000)
      }
      if (page.url().includes('/login')) throw new Error('仍停留在登录页')
      const body = await page.locator('body').innerText()
      if (!/搜索|歌单|下载队列/.test(body)) throw new Error('登录后未进入主界面')
      await t.shot(page, 'logged-in')
      return page.url().replace(base, '') || '/'
    },
    { severity: 'P0' },
  )

  // ---- 会话有效 ----
  await t.assert(
    'E2E-AUTH-06',
    '登录后接口可访问',
    async () => {
      const status = await page.evaluate(async (p) => {
        const r = await fetch(p)
        return r.status
      }, apiPath.authMe)
      if (status !== 200) throw new Error(`/api/auth/me=${status}`)
      const settings = await page.evaluate(async (p) => (await fetch(p)).status, apiPath.settings)
      if (settings !== 200) throw new Error(`/api/settings=${settings}`)
      return `me=200 settings=200`
    },
    { severity: 'P0' },
  )

  // ---- 退出后失效 ----
  await t.assert(
    'E2E-AUTH-07',
    '退出登录后回到登录页且接口失效',
    async () => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      const logout = page.getByRole('button', { name: /退出/ }).first()
      if (!(await logout.count())) throw new Error('未找到退出入口')
      await logout.click()
      await page.waitForTimeout(2500)
      if (!page.url().includes('/login')) throw new Error(`退出后仍在 ${page.url().replace(base, '')}`)
      const status = await page.evaluate(async (p) => (await fetch(p)).status, apiPath.settings)
      if (status !== 401) throw new Error(`退出后接口仍可用：${status}`)
      return '回到 /login，接口 401'
    },
    { severity: 'P0' },
  )
}
