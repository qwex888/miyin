// E2E-ENQ：入队链路 —— 重复裁决弹窗、库外歌曲真实入队。
// 会产生真实下载（每端最多 E2E_MAX_DOWNLOADS 首），用于后续 download spec 校验落盘。
import { sel, text } from '../selectors.mjs'
import { waitEnabled } from './20-search.mjs'

export const meta = {
  tag: 'enqueue',
  title: '入队与重复裁决',
  order: 30,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, isMobile, keyword, api, state, maxDownloads } = ctx
  t.setPhase('/#enqueue')

  // 进搜索页并出结果（本 spec 独立，不依赖 search spec 的页面状态）
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.locator(sel.searchInput).first().fill(keyword)
  await page.locator(sel.searchButton).first().click()
  const ok = await page
    .locator(sel.songRow)
    .first()
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  if (!ok) {
    t.skip('E2E-ENQ-01', '重复歌曲触发裁决弹窗', '搜索结果为空（上游波动）')
    t.skip('E2E-ENQ-02', '库外歌曲可入队', '搜索结果为空（上游波动）')
    return
  }
  // 歌曲列表是虚拟列表：首行出现时行数还在增长，行节点会被复用重建。
  // 立刻读 innerText / 点 checkbox 会踩到「节点已脱离文档」的瞬时态，等一拍再操作。
  await page.waitForTimeout(1800)

  // ---- 01 重复裁决 ----
  const libRow = page.locator(sel.songRow).filter({ hasText: text.inLibrary }).first()
  if (await libRow.count()) {
    await t.assert(
      'E2E-ENQ-01',
      '库内歌曲触发重复裁决且可取消',
      async () => {
        await libRow.locator(sel.songRowCheckIn).click()
        await page.waitForTimeout(300)
        await page.locator(sel.toolbarActions).filter({ hasText: /下载选中/ }).first().click()
        await page.waitForTimeout(2500)

        const modal = page.locator(sel.overlay).filter({ hasText: text.duplicate }).first()
        if (!(await modal.isVisible().catch(() => false))) throw new Error('未出现重复裁决弹窗')
        const txt = (await modal.innerText()).replace(/\s+/g, ' ')
        if (!/跳过|替换/.test(txt)) throw new Error(`弹窗缺少跳过/替换：${txt.slice(0, 40)}`)
        await t.shot(page, 'dup-dialog')

        await modal.getByRole('button', { name: /^取消$/ }).first().click().catch(async () => {
          await page.keyboard.press('Escape')
        })
        await page.waitForTimeout(1500)
        if (await modal.isVisible().catch(() => false)) throw new Error('取消后弹窗仍在')

        // 取消必须解除入队锁，否则用户会卡死（历史 bug）
        const all = page.locator(sel.toolbarSelectAll).first()
        const released = await waitEnabled(page, all, 8000)
        if (!released) throw new Error('取消裁决后工具栏仍锁定')

        await page.locator(sel.toolbarActions).filter({ hasText: /清空选择/ }).first().click().catch(() => {})
        await page.waitForTimeout(400)
        return `提供跳过/替换 · 取消后解锁`
      },
      { severity: 'P0' },
    )
  } else {
    t.skip('E2E-ENQ-01', '库内歌曲触发重复裁决', '搜索结果中无「已在库」歌曲（快照库为空或该歌手未下载过）')
  }

  // ---- 02 库外歌曲真实入队 ----
  await t.assert(
    'E2E-ENQ-02',
    '库外歌曲可入队且进入队列',
    async () => {
      const rows = page.locator(sel.songRow)
      const n = await rows.count()
      let pickedIdx = -1
      let pickedTitle = ''
      for (let i = 0; i < n && i < 30; i++) {
        const txt = await rows.nth(i).innerText().catch(() => '')
        if (txt && !txt.includes(text.inLibrary)) {
          pickedIdx = i
          pickedTitle = txt.split('\n')[0].trim()
          break
        }
      }
      if (pickedIdx < 0) throw new Error(`前 ${Math.min(n, 30)} 行均在库，无可入队歌曲`)

      await clickRowCheck(page, pickedIdx)
      await page.waitForTimeout(300)
      const btn = page.locator(sel.toolbarActions).filter({ hasText: /下载选中/ }).first()
      await waitEnabled(page, btn, 15000)
      await btn.click({ timeout: 15000 })
      await page.waitForTimeout(3500)

      // 库外歌曲不应触发重复裁决
      const dup = await page.locator(sel.overlay).filter({ hasText: text.duplicate }).first().isVisible().catch(() => false)
      if (dup) throw new Error('库外歌曲意外触发重复裁决')

      const res = page.locator(sel.overlay).filter({ hasText: /入队|已添加|成功|添加/ }).first()
      let feedback = ''
      if (await res.isVisible().catch(() => false)) {
        feedback = (await res.innerText()).replace(/\s+/g, ' ').slice(0, 50)
        await t.shot(page, 'enqueue-result')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(600)
      }

      // 以接口为准：确认任务真的落库
      const q = await api.get('/api/downloads?tab=all&limit=300')
      const items = q.json?.items || []
      const hit = items.find((x) => x.title && pickedTitle && x.title.includes(pickedTitle.slice(0, 6)))
      if (!hit) throw new Error(`队列里找不到「${pickedTitle}」`)

      // 交给 download spec 做落盘与音频校验
      state.enqueued = state.enqueued || []
      if (state.enqueued.length < maxDownloads) {
        state.enqueued.push({ id: hit.id, title: hit.title, profile: ctx.profile })
      }
      return `「${hit.title}」status=${hit.status}${feedback ? ` · ${feedback}` : ''}`
    },
    { severity: 'P0', evidence: [await t.shot(page, 'after-enqueue')] },
  )

  void isMobile
}

/**
 * 点某一行的复选框。
 *
 * 搜索结果用虚拟列表，滚动或数据刷新时行节点会被回收重建，
 * 点了可能报「element is not attached」。这里先滚到可见，
 * 失败等一拍再用最新节点重试一次。
 */
async function clickRowCheck(page, index) {
  const target = () => page.locator(sel.songRow).nth(index)
  await target().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
  try {
    await target().locator(sel.songRowCheckIn).click({ timeout: 8000 })
  } catch {
    await page.waitForTimeout(900)
    await target().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await target().locator(sel.songRowCheckIn).click({ timeout: 15000 })
  }
}
