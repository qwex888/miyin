// E2E-PLAYLIST：歌单页 —— 入口、工具栏、链接输入。
// 不做真实解析（消耗上游且耗时），解析能力由服务端单测覆盖。
import { sel } from '../selectors.mjs'

export const meta = {
  tag: 'playlist',
  title: '歌单页',
  order: 50,
  profiles: ['pc', 'mobile'],
}

export default async function run(t, ctx) {
  const { page, base } = ctx
  t.setPhase('/playlist')

  await page.goto(base + '/playlist', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  await t.assert(
    'E2E-PLAYLIST-01',
    '解析工具栏齐全',
    async () => {
      const body = await page.locator('body').innerText()
      const need = ['仅解析', '解析并全部下载']
      const miss = need.filter((k) => !body.includes(k))
      if (miss.length) throw new Error(`缺少按钮：${miss.join('/')}`)
      return need.join(' + ')
    },
    { severity: 'P1', evidence: [await t.shot(page, 'playlist')] },
  )

  await t.assert(
    'E2E-PLAYLIST-02',
    '歌单链接可输入',
    async () => {
      // 歌单页用的是单行 <input class="input">（不是 textarea），placeholder 含「歌单链接」
      const input = page.locator('input[placeholder*="歌单链接"]').first()
      if (!(await input.count())) throw new Error('未找到歌单链接输入框')
      const url = 'https://music.163.com/playlist?id=3778678'
      await input.fill(url)
      await page.waitForTimeout(300)
      const v = await input.inputValue()
      if (!v.includes('3778678')) throw new Error(`输入未生效：${v.slice(0, 30)}`)
      // 有链接后按钮应解禁，这是「输入驱动 UI」的实证
      const btn = page.getByRole('button', { name: '仅解析' }).first()
      if (await btn.isDisabled().catch(() => true)) throw new Error('输入链接后「仅解析」仍禁用')
      await input.fill('')
      return '输入 → 回读一致 → 按钮解禁'
    },
    { severity: 'P2' },
  )

  void sel
}
