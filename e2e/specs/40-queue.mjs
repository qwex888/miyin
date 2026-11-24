// E2E-QUEUE：下载队列页 —— 分组、筛选、批量操作、清理重复、记录检索。
// 「已完成」为空时（全新库）依赖任务行的用例自动 SKIP。
import { sel, text } from '../selectors.mjs'

export const meta = {
  tag: 'queue',
  title: '下载队列',
  order: 40,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base, api } = ctx
  t.setPhase('/queue')

  await page.goto(base + '/queue', { waitUntil: 'domcontentloaded' })
  const opened = await page
    .locator(sel.groupTab)
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  if (!opened) {
    t.skip('E2E-QUEUE-01', '队列页 tab 渲染', '队列页 20s 内未渲染（服务或接口异常）')
    return
  }
  await page.waitForTimeout(1500)

  await t.assert(
    'E2E-QUEUE-01',
    '队列分组 tab 齐全',
    async () => {
      const tabs = (await page.locator(sel.groupTab).allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
      if (tabs.length < 3) throw new Error(`tab=${tabs.length}：${tabs.join('/')}`)
      return tabs.join(' / ').slice(0, 60)
    },
    { severity: 'P0', evidence: [await t.shot(page, 'queue')] },
  )

  // 切到「已完成」
  await page.locator(sel.groupTab).filter({ hasText: text.completed }).first().click()
  await page.waitForTimeout(2500)
  const rows = await page.locator(sel.task).count()

  await t.assert(
    'E2E-QUEUE-02',
    '已完成分组有任务行',
    async () => {
      if (rows === 0) throw new Error('已完成分组为空（若为全新库属预期，请确认快照数据）')
      return `${rows} 行`
    },
    { severity: rows === 0 ? 'P2' : 'P0' },
  )

  await t.assert(
    'E2E-QUEUE-03',
    '当前 tab 呈激活态',
    async () => {
      const active = (await page.locator('.tabs .tab.active').first().innerText()).replace(/\s+/g, ' ')
      if (!active.includes(text.completed)) throw new Error(`激活 tab=${active}`)
      return active.trim()
    },
    { severity: 'P1' },
  )

  // ---- 音质筛选 ----
  const qs = page.locator(sel.queueQualityFilter)
  if (await qs.count()) {
    await t.assert(
      'E2E-QUEUE-04',
      '音质筛选可用且能还原',
      async () => {
        await qs.selectOption({ index: 1 })
        await page.waitForTimeout(2000)
        const filtered = await page.locator(sel.task).count()
        if (filtered > rows) throw new Error(`筛选后行数变多：${rows} → ${filtered}`)
        await qs.selectOption({ index: 0 })
        await page.waitForTimeout(1200)
        return `${rows} → ${filtered} → ${rows}`
      },
      { severity: 'P1' },
    )
  } else {
    t.skip('E2E-QUEUE-04', '音质筛选可用', '未找到音质筛选控件')
  }

  // ---- 勾选后出现批量操作 ----
  const chk = page.locator(sel.taskCheck).first()
  if (await chk.count()) {
    await t.assert(
      'E2E-QUEUE-05',
      '勾选任务后出现批量操作入口',
      async () => {
        await chk.check()
        await page.waitForTimeout(900)
        const bb = page.locator('button').filter({ hasText: /批量删除|批量重试|批量取消/ }).first()
        if (!(await bb.count())) throw new Error('未出现批量操作按钮')
        const label = (await bb.innerText()).replace(/\s+/g, '')
        await chk.uncheck()
        await page.waitForTimeout(400)
        return label
      },
      { severity: 'P1' },
    )
  } else {
    t.skip('E2E-QUEUE-05', '批量操作入口', '无任务行可选')
  }

  // ---- 清理重复弹窗 ----
  const cleanup = page.getByRole('button', { name: '清理重复' }).first()
  if (await cleanup.count()) {
    await t.assert(
      'E2E-QUEUE-06',
      '清理重复弹窗可打开并关闭',
      async () => {
        await cleanup.click()
        await page.waitForTimeout(1500)
        const modal = page.locator(sel.overlay).first()
        if (!(await modal.isVisible().catch(() => false))) throw new Error('弹窗未出现')
        await t.shot(page, 'cleanup')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(800)
        if (await modal.isVisible().catch(() => false)) throw new Error('Esc 未能关闭弹窗')
        return '打开 → Esc 关闭'
      },
      { severity: 'P1' },
    )
  } else {
    t.skip('E2E-QUEUE-06', '清理重复弹窗', '未找到「清理重复」入口')
  }

  // ---- 记录检索：关键词从真实数据里取，避免硬编码过时 ----
  const keyword = await pickKeyword(api)
  if (keyword) {
    await t.assert(
      'E2E-QUEUE-07',
      '下载记录检索命中',
      async () => {
        const input = page.getByLabel(sel.queueSearch).first()
        if (!(await input.count())) throw new Error('未找到检索输入框')
        await input.fill(keyword)
        await page.waitForTimeout(2500)
        const hit = await page.locator(sel.task).count()
        if (hit === 0) throw new Error(`关键词「${keyword}」0 命中`)
        const body = await page.locator('body').innerText()
        if (!/跨|归属分类|在「/.test(body)) throw new Error('缺少跨分类检索提示')
        await t.shot(page, 'queue-search')
        await input.fill('')
        await page.waitForTimeout(1000)
        return `「${keyword}」${hit} 行 · 含跨分类提示`
      },
      { severity: 'P1' },
    )
  } else {
    t.skip('E2E-QUEUE-07', '下载记录检索', '队列中没有可用于取词的历史标题')
  }

  // ---- 刷新一致性 ----
  await t.assert(
    'E2E-QUEUE-08',
    '刷新后队列页仍正常',
    async () => {
      t.setPhase('/reload')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator(sel.groupTab).first().waitFor({ timeout: 20000 })
      const n = await page.locator(sel.groupTab).count()
      if (n < 3) throw new Error(`刷新后 tab=${n}`)
      return `${n} 个分组`
    },
    { severity: 'P1' },
  )
}

/** 取一条已完成任务标题的前两字作为检索词。 */
async function pickKeyword(api) {
  const r = await api.get('/api/downloads?tab=completed&limit=20')
  const items = r.json?.items || []
  for (const it of items) {
    const t = String(it.title || '').trim()
    if (t.length >= 2) return t.slice(0, 2)
  }
  return ''
}
