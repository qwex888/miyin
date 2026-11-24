// E2E-SEARCH：搜索、聚合、详情、选择区。
// 依赖上游音源可用性：先做 API 预检，全平台无结果时整组 SKIP（不误报为缺陷）。
import { sel, text } from '../selectors.mjs'

export const meta = {
  tag: 'search',
  title: '搜索与聚合',
  order: 20,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, isMobile, keyword, api } = ctx
  t.setPhase('/#search')

  // ---- 预检：上游是否可用 ----
  const probe = await api.post('/api/search', { keyword, platform: 'wy', page: 1 })
  const probeItems = pickItems(probe.json)
  if (!probeItems.length) {
    for (const [i, name] of [
      ['01', '搜索结果渲染'],
      ['02', '工具栏计数'],
      ['03', '切平台有结果'],
      ['04', '单曲/专辑视图往返'],
      ['05', '详情面板'],
      ['06', '全选与清空'],
    ]) {
      t.skip(`E2E-SEARCH-${i}`, name, `上游无结果（wy status=${probe.status}），无法验证界面`)
    }
    return
  }

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  // ---- 01 搜索出结果 ----
  await t.assert(
    'E2E-SEARCH-01',
    '搜索结果渲染',
    async () => {
      await page.locator(sel.searchInput).first().fill(keyword)
      await page.locator(sel.searchButton).first().click()
      await page.locator(sel.songRow).first().waitFor({ timeout: 30000 })
      const n = await page.locator(sel.songRow).count()
      if (n === 0) throw new Error('0 行')
      return `${n} 行 · 关键词「${keyword}」`
    },
    { severity: 'P0', evidence: [await t.shot(page, 'search')] },
  )

  // ---- 02 工具栏计数 ----
  await t.assert(
    'E2E-SEARCH-02',
    '工具栏显示已加载数量',
    async () => {
      const txt = (await page.locator(sel.toolbarCount).first().innerText()).replace(/\s+/g, ' ')
      if (!/已加载\s*\d+/.test(txt)) throw new Error(`文案=${txt}`)
      return txt.slice(0, 30)
    },
    { severity: 'P1' },
  )

  // ---- 03 切换平台 ----
  await t.assert(
    'E2E-SEARCH-03',
    '切换音源平台后有结果',
    async () => {
      const tab = page.locator(sel.platformTabs).last().locator('.tab').filter({ hasText: 'kw' }).first()
      if (!(await tab.count())) throw new Error('未找到 kw 平台 tab')
      await tab.click()
      await page.waitForTimeout(4000)
      const n = await page.locator(sel.songRow).count()
      if (n === 0) throw new Error('切平台后 0 行（可能是上游波动）')
      return `kw ${n} 行`
    },
    { severity: 'P1' },
  )

  // ---- 04 专辑视图往返 ----
  await t.assert(
    'E2E-SEARCH-04',
    '单曲 ↔ 专辑视图可往返',
    async () => {
      const album = page.getByRole('button', { name: /^专辑$/ }).first()
      if (!(await album.count())) throw new Error('未找到「专辑」切换')
      await album.click()
      await page.waitForTimeout(3500)
      await t.shot(page, 'album')
      const back = page.getByRole('button', { name: /^单曲$/ }).first()
      await back.click()
      await page.waitForTimeout(2500)
      const n = await page.locator(sel.songRow).count()
      if (n === 0) throw new Error('切回单曲后 0 行')
      return `往返后 ${n} 行`
    },
    { severity: 'P1' },
  )

  // ---- 05 详情面板 ----
  await t.assert(
    'E2E-SEARCH-05',
    '点击歌曲打开详情面板',
    async () => {
      await page.locator(sel.songRow).first().click()
      await page.waitForTimeout(900)
      const sheet = page.locator(sel.detailPanel).first()
      if (!(await sheet.isVisible().catch(() => false))) throw new Error('详情面板未出现')
      const box = await sheet.boundingBox()
      if (!box || box.width < 120) throw new Error(`面板尺寸异常 ${box ? Math.round(box.width) : 'none'}`)
      const txt = await sheet.innerText()
      if (!text.quality.test(txt)) throw new Error('详情面板缺少音质信息')
      await t.shot(page, 'detail')
      if (isMobile) {
        await page.locator(sel.closeButton).first().click().catch(() => {})
        await page.waitForTimeout(400)
      }
      return `${Math.round(box.width)}x${Math.round(box.height)} · 含音质`
    },
    { severity: 'P1' },
  )

  // ---- 06 全选与清空 ----
  await t.assert(
    'E2E-SEARCH-06',
    '全选计数正确且可清空',
    async () => {
      // 入队/刷新期间全选会短暂禁用，先等它可用
      const all = page.locator(sel.toolbarSelectAll).first()
      await waitEnabled(page, all, 15000)
      await all.click()
      await page.waitForTimeout(600)
      const btn = page.locator(sel.toolbarActions).filter({ hasText: /下载选中/ }).first()
      const n = Number(((await btn.innerText()).match(/(\d+)/) || [])[1] || 0)
      if (n <= 1) throw new Error(`全选后计数=${n}`)
      await page.locator(sel.toolbarActions).filter({ hasText: /清空选择/ }).first().click()
      await page.waitForTimeout(500)
      const after = (await btn.innerText()).replace(/\s+/g, '')
      if (!/（0）/.test(after)) throw new Error(`清空后=${after}`)
      return `全选 ${n} → 清空 0`
    },
    { severity: 'P1' },
  )

  // 单首勾选（为后续入队用例准备状态，同时验证计数文案）
  await t.assert(
    'E2E-SEARCH-07',
    '勾选单首后计数为 1',
    async () => {
      await page.locator(sel.songRowCheck).first().click()
      await page.waitForTimeout(400)
      const btn = page.locator(sel.toolbarActions).filter({ hasText: /下载选中/ }).first()
      const txt = (await btn.innerText()).replace(/\s+/g, ' ')
      if (!/1/.test(txt)) throw new Error(`文案=${txt}`)
      await page.locator(sel.toolbarActions).filter({ hasText: /清空选择/ }).first().click()
      await page.waitForTimeout(300)
      return txt.slice(0, 24)
    },
    { severity: 'P2' },
  )
}

function pickItems(json) {
  if (!json) return []
  for (const k of ['items', 'songs', 'list', 'data']) {
    if (Array.isArray(json[k])) return json[k]
  }
  return []
}

export async function waitEnabled(page, locator, ms = 15000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!(await locator.isDisabled().catch(() => true))) return true
    await page.waitForTimeout(300)
  }
  return false
}
