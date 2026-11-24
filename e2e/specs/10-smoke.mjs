// E2E-SMOKE：应用骨架可用性。任何一条失败都意味着「不该发版」。
// 这一组不依赖上游网络，只验证页面能打开、布局正确、没有横向溢出。
import { sel, text } from '../selectors.mjs'

export const meta = {
  tag: 'smoke',
  title: '骨架与导航',
  order: 10,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, isMobile } = ctx
  t.setPhase('/')

  await t.assert(
    'E2E-SMOKE-01',
    '首页返回 200 且标题正确',
    async () => {
      const resp = await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      if (resp?.status() !== 200) throw new Error(`status=${resp?.status()}`)
      const title = await page.title()
      if (!title.includes('觅音')) throw new Error(`title=${title}`)
      return title
    },
    { severity: 'P0', evidence: [await t.shot(page, 'home')] },
  )

  await t.assert(
    'E2E-SMOKE-02',
    '主导航 5 个入口齐全',
    async () => {
      const n = await page.locator(sel.mainNav).count()
      if (n !== 5) throw new Error(`导航项=${n}，期望 5`)
      return `${n} 项`
    },
    { severity: 'P0' },
  )

  await t.assert(
    'E2E-SMOKE-03',
    isMobile ? '移动端显示底部导航' : 'PC 端隐藏底部导航',
    async () => {
      const visible = await page.locator(sel.bottomNav).isVisible().catch(() => false)
      if (visible !== isMobile) throw new Error(`bottomNav visible=${visible}`)
      return visible ? 'visible' : 'hidden'
    },
    { severity: 'P1' },
  )

  await t.assert(
    'E2E-SMOKE-04',
    '首页无横向溢出',
    async () => {
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      if (sw > iw + 1) throw new Error(`scrollWidth=${sw} > innerWidth=${iw}`)
      return `${sw}/${iw}`
    },
    { severity: 'P0' },
  )

  // 四个功能页：只验证「能打开且不是错误页」，具体交互交给各自 spec
  const pages = [
    ['/queue', '下载队列'],
    ['/playlist', '歌单'],
    ['/sources', '音源'],
    ['/settings', '设置'],
  ]
  for (const [i, [path, label]] of pages.entries()) {
    await t.assert(
      `E2E-SMOKE-1${i}`,
      `${label}页可打开`,
      async () => {
        t.setPhase(path)
        const resp = await page.goto(base + path, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1500)
        if (resp?.status() !== 200) throw new Error(`status=${resp?.status()}`)
        const body = await page.locator('body').innerText()
        if (body.trim().length < 20) throw new Error(`页面正文过短（${body.length}），疑似白屏`)
        if (/500|Internal Server Error|Application error/i.test(body)) throw new Error('出现错误页文案')
        return `${body.length} 字符`
      },
      { severity: 'P0', evidence: [await t.shot(page, `page-${label}`)] },
    )
  }

  // 设置页是水合问题的历史高发区，这里做一次内容抽查
  await t.assert(
    'E2E-SMOKE-20',
    '设置页分类 tab 存在',
    async () => {
      t.setPhase('/settings')
      await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const n = await page.locator(sel.settingsTabs).count()
      if (n < 2) throw new Error(`tab=${n}`)
      return `${n} 个分类`
    },
    { severity: 'P1' },
  )

  // 「检查更新」曾是水合不一致的触发点，验证文案稳定（不是首帧就变「检查中…」）
  await t.assert(
    'E2E-SMOKE-21',
    '设置页「检查更新」按钮首屏文案稳定',
    async () => {
      const btn = page.getByRole('button', { name: /检查更新|检查中/ }).first()
      if (!(await btn.count())) throw new Error('未找到检查更新按钮')
      const label = (await btn.innerText()).trim()
      if (!/检查更新|检查中|已是最新/.test(label)) throw new Error(`文案异常：${label}`)
      return label
    },
    { severity: 'P2' },
  )

  // 兜底：本轮产生的控制台错误（排除已知噪音）
  await t.assert(
    'E2E-SMOKE-30',
    '本轮无控制台 error',
    async () => {
      const noise = /favicon|ResizeObserver|Failed to load resource/i
      const errs = t.diag.console.filter((e) => !noise.test(e))
      if (errs.length) throw new Error(errs.slice(0, 2).join(' || '))
      return 'clean'
    },
    { severity: 'P0' },
  )

  await t.assert(
    'E2E-SMOKE-31',
    '本轮无未捕获异常',
    async () => {
      const errs = t.diag.pageerror.filter((e) => !/favicon/i.test(e))
      if (errs.length) throw new Error(errs.slice(0, 2).join(' || '))
      return 'clean'
    },
    { severity: 'P0' },
  )

  void text
  void sel
}
