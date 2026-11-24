// E2E-A11Y：可访问性与移动端可用性基线检查。
//
// 阈值取工程可接受值而非 WCAG 严格值：图标按钮 32px 以上即通过，
// 避免把「关闭按钮 32px」这类大量噪音算成缺陷。真正需要关注的是
// 无名字的**按钮/链接/下拉**（屏幕阅读器无法播报）与整页横向滚动。
//
// 明确排除的已知噪音：
// - 列表/表格里的 checkbox 靠同行标题文本提供上下文，本身无 aria-label，
//   是常见实现，记为观察项而不是失败。
// - 容器内部滚动（如移动端音源表格外层 overflow-x:auto）会让子元素 rect
//   超出视口，但页面本身不横向滚动，不是缺陷 —— 所以只检查
//   documentElement.scrollWidth。
export const meta = {
  tag: 'a11y',
  title: '可访问性基线',
  order: 95,
  profiles: ['pc', 'mobile'],
}

const PAGES = ['/', '/queue', '/sources', '/settings']
const MIN_TAP = 32

export default async function run(t, ctx) {
  const { page, base, isMobile } = ctx

  await t.assert(
    'E2E-A11Y-01',
    '按钮/链接/下拉均有可访问名称',
    async () => {
      const bad = []
      for (const p of PAGES) {
        t.setPhase(p)
        await page.goto(base + p, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1600)
        const found = await page.evaluate(() => {
          const out = []
          for (const el of document.querySelectorAll('button, a[href], select')) {
            if (el.offsetParent === null) continue
            const name =
              (el.getAttribute('aria-label') || '').trim() ||
              (el.getAttribute('title') || '').trim() ||
              (el.textContent || '').trim()
            if (!name) out.push(el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0])
          }
          return out
        })
        bad.push(...found.map((x) => `${p}:${x}`))
      }
      if (bad.length) throw new Error(`${bad.length} 个无名称控件：${[...new Set(bad)].slice(0, 4).join(', ')}`)
      return '全部有名'
    },
    { severity: 'P1' },
  )

  // 表单控件：label / aria-label / placeholder / 包裹 label 任一即可，只作观察项
  await t.assert(
    'E2E-A11Y-02',
    '表单控件有标签或占位提示',
    async () => {
      const bad = []
      for (const p of PAGES) {
        t.setPhase(p)
        await page.goto(base + p, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1400)
        const found = await page.evaluate(() => {
          const out = []
          for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
            if (el.offsetParent === null) continue
            const labelled =
              el.getAttribute('aria-label') ||
              el.getAttribute('aria-labelledby') ||
              el.getAttribute('placeholder') ||
              el.closest('label') ||
              (el.id && document.querySelector(`label[for="${el.id}"]`))
            if (!labelled) out.push(`${el.tagName.toLowerCase()}:${el.getAttribute('type') || el.type || ''}`)
          }
          return out
        })
        bad.push(...found.map((x) => `${p}:${x}`))
      }
      return bad.length
        ? `${bad.length} 个控件缺标签（观察项）：${[...new Set(bad)].slice(0, 3).join(', ')}`
        : '全部有标签'
    },
    { severity: 'P2' },
  )

  await t.assert(
    'E2E-A11Y-03',
    isMobile ? '移动端主要触控目标 ≥ 32px' : 'PC 端主要控件尺寸合理',
    async () => {
      t.setPhase('/#tap')
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1600)
      const threshold = isMobile ? MIN_TAP : 24
      const small = await page.evaluate((min) => {
        const out = []
        for (const el of document.querySelectorAll('button, a[href], select')) {
          if (el.offsetParent === null) continue
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.height < min) out.push(`${el.tagName.toLowerCase()}:${Math.round(r.height)}px`)
        }
        return out
      }, threshold)
      // 允许少量偏小（图标按钮），超过 4 个才算系统性偏差
      if (small.length > 4) throw new Error(`${small.length} 个过小（阈值 ${threshold}px）：${small.slice(0, 4).join(', ')}`)
      return small.length ? `${small.length} 个偏小（可接受）` : '全部达标'
    },
    { severity: 'P2' },
  )

  await t.assert(
    'E2E-A11Y-04',
    '页面不产生整页横向滚动',
    async () => {
      const bad = []
      for (const p of PAGES) {
        t.setPhase(p)
        await page.goto(base + p, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1500)
        const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
        if (sw > iw + 2) bad.push(`${p}:${sw}>${iw}`)
      }
      if (bad.length) throw new Error(`横向溢出：${bad.join(', ')}`)
      return `${PAGES.length} 页均无横向滚动`
    },
    { severity: 'P1' },
  )

  await t.assert(
    'E2E-A11Y-05',
    '页面存在主标题或地标',
    async () => {
      const problems = []
      for (const p of PAGES) {
        t.setPhase(p)
        await page.goto(base + p, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1200)
        const ok = await page.evaluate(
          () => !!document.querySelector('h1, main, [role=main]') || !!document.querySelector('nav[aria-label]'),
        )
        if (!ok) problems.push(p)
      }
      if (problems.length) throw new Error(`缺少标题/地标：${problems.join(',')}`)
      return '结构完整'
    },
    { severity: 'P2' },
  )
}
