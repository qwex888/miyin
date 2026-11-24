// E2E-SOURCES：音源管理 —— 列表、新增抽屉、编辑预填、启停往返。
// 启停会真实写库，用例结束前必须还原（否则污染后续运行与快照）。
import { sel } from '../selectors.mjs'

export const meta = {
  tag: 'sources',
  title: '音源管理',
  order: 60,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, api, isMobile } = ctx
  t.setPhase('/sources')

  await page.goto(base + '/sources', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const list = await api.get('/api/sources')
  const items = list.json?.items || []
  const first = items[0]

  await t.assert(
    'E2E-SOURCES-01',
    '音源接口返回列表',
    async () => {
      if (list.status !== 200) throw new Error(`status=${list.status}`)
      if (!items.length) throw new Error('列表为空')
      return `${items.length} 个音源`
    },
    { severity: 'P0' },
  )

  await t.assert(
    'E2E-SOURCES-02',
    '音源表格渲染',
    async () => {
      const rows = await page.locator(sel.sourceTable).count()
      if (rows === 0) throw new Error('表格无行')
      return `${rows} 行`
    },
    { severity: 'P0', evidence: [await t.shot(page, 'sources')] },
  )

  // ---- 新增抽屉 ----
  await t.assert(
    'E2E-SOURCES-03',
    '新增音源抽屉可打开并取消',
    async () => {
      const btn = page.getByRole('button', { name: '单个新增' }).first()
      if (!(await btn.count())) throw new Error('未找到「单个新增」')
      await btn.click()
      await page.waitForTimeout(1000)
      const dlg = page.locator(sel.dialog).first()
      if (!(await dlg.isVisible().catch(() => false))) throw new Error('抽屉未出现')
      if ((await dlg.locator('input').count()) < 2) throw new Error('抽屉内表单字段不足')
      await t.shot(page, 'source-add')
      // 主路径走「取消」按钮；Esc 与焦点内聚见 E2E-SOURCES-06/07
      await dlg.getByRole('button', { name: /取消/ }).first().click()
      await page.waitForTimeout(800)
      if (await dlg.isVisible().catch(() => false)) throw new Error('取消后抽屉仍在')
      return '打开 → 取消关闭'
    },
    { severity: 'P1' },
  )

  // ---- 键盘可达性：Esc 关闭 + 焦点内聚 ----
  await t.assert(
    'E2E-SOURCES-06',
    'Esc 可关闭音源抽屉',
    async () => {
      const btn = page.getByRole('button', { name: '单个新增' }).first()
      if (!(await btn.count())) throw new Error('未找到「单个新增」')
      await btn.click()
      await page.waitForTimeout(900)
      const dlg = page.locator(sel.dialog).first()
      if (!(await dlg.isVisible().catch(() => false))) throw new Error('抽屉未打开')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      if (await dlg.isVisible().catch(() => false)) throw new Error('Esc 后抽屉仍在')
      return '打开 → Esc 关闭'
    },
    { severity: 'P1' },
  )

  await t.assert(
    'E2E-SOURCES-07',
    '焦点进入抽屉、Tab 内循环、关闭后归还',
    async () => {
      const trigger = page.getByRole('button', { name: '单个新增' }).first()
      await trigger.click()
      await page.waitForTimeout(900)
      const dlg = page.locator(sel.dialog).first()
      if (!(await dlg.isVisible().catch(() => false))) throw new Error('抽屉未打开')

      const activeInfo = () =>
        page.evaluate(() => {
          const root = document.querySelector('[role="dialog"]')
          const el = document.activeElement
          return {
            inside: !!root && !!el && root.contains(el),
            tag: el?.tagName?.toLowerCase() || '',
            text: (el?.textContent || '').trim().slice(0, 16),
          }
        })

      const landed = await activeInfo()
      if (!landed.inside) throw new Error(`打开后焦点未进入抽屉（停在 ${landed.tag}）`)
      if (landed.tag !== 'input') throw new Error(`打开后焦点应落在名称输入框，实际是 ${landed.tag}`)

      for (let i = 1; i <= 12; i++) {
        await page.keyboard.press('Tab')
        const cur = await activeInfo()
        if (!cur.inside) throw new Error(`第 ${i} 次 Tab 后焦点漏到抽屉外（${cur.tag}「${cur.text}」）`)
      }
      for (let i = 1; i <= 4; i++) {
        await page.keyboard.press('Shift+Tab')
        const cur = await activeInfo()
        if (!cur.inside) throw new Error(`第 ${i} 次 Shift+Tab 后焦点漏到抽屉外（${cur.tag}「${cur.text}」）`)
      }

      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      if (await dlg.isVisible().catch(() => false)) throw new Error('Esc 后抽屉仍在')

      const restored = await page.evaluate(() => ({
        tag: document.activeElement?.tagName?.toLowerCase() || '',
        text: (document.activeElement?.textContent || '').trim().slice(0, 16),
      }))
      if (!/单个新增/.test(restored.text)) {
        throw new Error(`关闭后焦点未归还触发按钮（停在 ${restored.tag}「${restored.text}」）`)
      }
      return `首帧落 input · 12×Tab + 4×Shift+Tab 未外泄 · 归还「${restored.text}」`
    },
    { severity: 'P1' },
  )

  // ---- 编辑预填（移动端入口在 ··· 菜单里）----
  await t.assert(
    'E2E-SOURCES-04',
    '编辑抽屉带入已有数据',
    async () => {
      const direct = page.getByRole('button', { name: '编辑' }).first()
      if (await direct.isVisible().catch(() => false)) {
        await direct.click()
      } else {
        const more = page.locator(sel.sourceMore).first()
        if (!(await more.count())) throw new Error('移动端未找到 ··· 入口')
        await more.click()
        await page.waitForTimeout(700)
        await page.getByRole('menuitem', { name: '编辑' }).first().click()
      }
      await page.waitForTimeout(1000)
      const dlg = page.locator(sel.dialog).first()
      if (!(await dlg.isVisible().catch(() => false))) throw new Error('编辑抽屉未出现')
      const name = await dlg.locator('input').first().inputValue()
      if (!name) throw new Error('名称未预填')
      await t.shot(page, 'source-edit')
      await dlg.getByRole('button', { name: /取消/ }).first().click().catch(() => {})
      await page.waitForTimeout(700)
      return `${name.slice(0, 24)}${isMobile ? '（··· 菜单进入）' : ''}`
    },
    { severity: 'P1' },
  )

  // ---- 启停往返 ----
  if (!first) {
    t.skip('E2E-SOURCES-05', '启停写库并还原', '无音源可用')
    return
  }
  await t.assert(
    'E2E-SOURCES-05',
    '停用/启用写库并还原',
    async () => {
      // 桌面端按钮直接可见；移动端在 ··· 菜单里
      const clickToggle = async (name) => {
        const direct = page.getByRole('button', { name, exact: true }).first()
        if (await direct.isVisible().catch(() => false)) {
          await direct.click()
          return
        }
        await page.locator(sel.sourceMore).first().click()
        await page.waitForTimeout(700)
        await page.getByRole('menuitem', { name: /停用|启用/ }).first().click()
      }

      const before = first.enabled
      await clickToggle(before ? '停用' : '启用')
      await page.waitForTimeout(2200)
      const mid = (await api.get('/api/sources')).json?.items?.find((s) => s.id === first.id)
      if (String(mid?.enabled) === String(before)) throw new Error(`状态未变化（仍 ${mid?.enabled}）`)

      // 还原
      await clickToggle(before ? '启用' : '停用')
      await page.waitForTimeout(2200)
      const back = (await api.get('/api/sources')).json?.items?.find((s) => s.id === first.id)
      if (String(back?.enabled) !== String(before)) throw new Error(`未还原（${back?.enabled} ≠ ${before}）`)
      return `${before} → ${mid?.enabled} → ${back?.enabled}`
    },
    { severity: 'P0' },
  )
}
