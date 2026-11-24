// E2E-HYDRATION：SSR 水合一致性回归。
//
// 背景：`/settings` 曾因「检查更新」按钮在客户端首帧被置为「检查中…」，
// 与服务端 HTML 的「检查更新」不一致，稳定报 `Hydration completed but contains mismatches`。
// 水合问题不会让页面白屏，但会导致首屏闪动、事件绑定错位，且只在生产构建下静默存在，
// 所以必须有独立回归。
import { sel } from '../selectors.mjs'

export const meta = {
  tag: 'hydration',
  title: '水合一致性',
  order: 90,
  profiles: ['pc', 'mobile'],
}

const PAGES = ['/', '/queue', '/settings', '/sources', '/playlist']
const ROUNDS = 2

export default async function run(t, ctx) {
  const { page, base } = ctx

  // 独立收集，避免全局 diag 里此前的记录干扰判定
  const hits = []
  page.on('console', (m) => {
    const txt = m.text()
    if (/[Hh]ydration|mismatch/i.test(txt)) hits.push(`${page.url().replace(base, '')} :: ${txt.slice(0, 160)}`)
  })

  await t.assert(
    'E2E-HYD-01',
    `重复加载 ${PAGES.length} 个页面 × ${ROUNDS} 轮无水合告警`,
    async () => {
      for (let r = 1; r <= ROUNDS; r++) {
        for (const p of PAGES) {
          t.setPhase(`${p}#r${r}`)
          await page.goto(base + p, { waitUntil: 'load', timeout: 25000 })
          await page.waitForTimeout(1200)
        }
      }
      if (hits.length) {
        const uniq = [...new Set(hits)].slice(0, 3)
        throw new Error(`${hits.length} 次：${uniq.join(' || ')}`)
      }
      return `${PAGES.length * ROUNDS} 次加载 0 告警`
    },
    { severity: 'P0' },
  )

  // 首屏文案不得在客户端立即变化（更贴近「闪动」这个用户可感知的症状）
  await t.assert(
    'E2E-HYD-02',
    '设置页首屏文案稳定（前后两次采样一致）',
    async () => {
      t.setPhase('/settings#stability')
      await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' })
      const early = await page.locator(sel.settingsTabs).first().innerText().catch(() => '')
      await page.waitForTimeout(2500)
      const late = await page.locator(sel.settingsTabs).first().innerText().catch(() => '')
      if (!early) throw new Error('首屏未渲染分类 tab')
      if (early.trim() !== late.trim()) throw new Error(`文案变化：「${early.trim()}」→「${late.trim()}」`)
      return early.trim()
    },
    { severity: 'P1' },
  )
}
