// E2E-SETTINGS：设置页 —— 分类遍历、数值项保存往返。
//
// 顺序放在 download 之后：并发数会直接影响下载 worker，
// 若在下载进行中改动，会让「任务超时」的归因变得含糊。
import { sel } from '../selectors.mjs'

export const meta = {
  tag: 'settings',
  title: '设置读写',
  order: 85,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, api } = ctx
  t.setPhase('/settings')

  await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)

  await t.assert(
    'E2E-SET-01',
    '设置分类可逐个切换',
    async () => {
      const tabs = page.locator(sel.settingsTabs)
      const n = await tabs.count()
      if (n < 2) throw new Error(`分类=${n}`)
      const names = []
      for (let i = 0; i < n; i++) {
        await tabs.nth(i).click()
        await page.waitForTimeout(600)
        const body = await page.locator('body').innerText()
        if (body.trim().length < 50) throw new Error(`第 ${i + 1} 个分类内容为空`)
        names.push((await tabs.nth(i).innerText()).replace(/\s+/g, ''))
      }
      return names.join(' / ').slice(0, 60)
    },
    { severity: 'P1' },
  )

  await t.assert(
    'E2E-SET-02',
    '并发下载数保存生效并可还原',
    async () => {
      await page.locator(sel.settingsTabs).filter({ hasText: '基础设置' }).first().click()
      await page.waitForTimeout(1200)
      const conc = page.locator('label', { hasText: '并发下载数' }).locator('input').first()
      if (!(await conc.count())) throw new Error('未找到并发下载数输入框')
      const orig = await conc.inputValue()
      const target = String(Number(orig) === 2 ? 3 : 2)
      await conc.fill(target)
      await page.getByRole('button', { name: '保存', exact: true }).first().click()
      await page.waitForTimeout(2500)

      const saved = (await api.get('/api/settings')).json?.concurrency
      if (String(saved) !== target) throw new Error(`保存后接口返回 ${saved}，期望 ${target}`)
      const body = await page.locator('body').innerText()
      if (!/已保存|保存成功/.test(body)) throw new Error('缺少保存成功提示')
      await t.shot(page, 'settings')

      // 还原（必须做，否则快照的默认值被本次运行改掉）
      await page.locator('label', { hasText: '并发下载数' }).locator('input').first().fill(orig)
      await page.getByRole('button', { name: '保存', exact: true }).first().click()
      await page.waitForTimeout(2200)
      const back = (await api.get('/api/settings')).json?.concurrency
      if (String(back) !== String(orig)) throw new Error(`未还原 ${back} ≠ ${orig}`)
      return `${orig} → ${target} → ${back}`
    },
    { severity: 'P0' },
  )

  // 设置页是 SSR 内容较多的页面，顺带验证刷新后内容一致
  await t.assert(
    'E2E-SET-03',
    '刷新后设置页正常',
    async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1800)
      const n = await page.locator(sel.settingsTabs).count()
      if (n < 2) throw new Error(`刷新后分类=${n}`)
      return `${n} 个分类`
    },
    { severity: 'P1' },
  )
}
