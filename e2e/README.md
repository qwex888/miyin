# E2E 真实 UI 测试

面向**发版前回归**的端到端测试套件：真实浏览器、真实后端、真实下载落盘。
它与 `tests/**/*.test.ts`（Vitest 单元/集成）是**互补**关系，不是替代。

| | `tests/`（Vitest） | `e2e/`（本目录） |
|---|---|---|
| 跑什么 | 单个函数/模块，mock 边界 | 完整链路：浏览器 → Nitro → SQLite → 上游 → 落盘 |
| 依赖环境 | 无（用临时库、内联脚本） | 需要构建产物 `.output/`、Chrome、网络、ffprobe |
| 典型耗时 | 全量约 40s | 全量约 5~6 分钟 |
| 抓什么 | 逻辑错误、边界条件 | 水合不一致、样式溢出、事件未绑定、真实音频有效性、鉴权可绕过 |
| 什么时候跑 | 每次改代码 | 发版前 / 动 UI 或下载链路时 |

历史上只有本套件抓到的问题：`/settings` 每页水合不一致、45MB 垃圾载荷被标记 `completed`、
移动端子路径部署下全站免鉴权、飞牛 baseURL 下 `pathname` 前缀导致鉴权失效。

---

## 快速开始

```bash
pnpm build          # 必须先构建，套件跑的是 .output/server/index.mjs
pnpm test:e2e       # PC + 移动端全量 + 鉴权（约 5~6 分钟）

pnpm test:e2e:list              # 列出所有模块
pnpm test:e2e --only=smoke      # 只跑骨架（最快，约 15s，适合提交前自查）
pnpm test:e2e --profile=mobile  # 只跑移动端
pnpm test:e2e --headed          # 有头模式，肉眼看着它点
```

首次使用需装 Playwright（仓库**未**把它列为依赖，避免给所有安装者增加 200MB+）：

```bash
pnpm add -D playwright && pnpm exec playwright install chromium
# 若本机已装 Chrome，可省去 install：套件默认用 channel=chrome
# 若 playwright 装在非常规位置：PLAYWRIGHT_PATH=/path/to/playwright pnpm test:e2e
```

`ffprobe` 可选：没有它时「音频可解码」用例标记 SKIP，其余照跑。

---

## 目录结构

```
e2e/
├── run.mjs                 # 入口：起隔离实例 → 跑各模块 → 出报告 → 退出码
├── selectors.mjs           # 选择器单一真相源（改 UI 后先改这里）
├── lib/
│   ├── config.mjs          # 参数与环境变量、profile 定义
│   ├── browser.mjs         # Playwright 定位（多路径探测）+ 浏览器/上下文创建
│   ├── server.mjs          # 隔离实例：库快照、改下载目录、清口令覆盖、端口探测
│   └── report.mjs          # 用例记录器 + JSON/Markdown 报告
├── specs/                  # 按 order 顺序执行，文件名前缀即顺序
│   ├── 10-smoke.mjs        # 骨架与导航
│   ├── 20-search.mjs       # 搜索与聚合
│   ├── 30-enqueue.mjs      # 入队与重复裁决
│   ├── 40-queue.mjs        # 下载队列页
│   ├── 50-playlist.mjs     # 歌单页
│   ├── 60-sources.mjs      # 音源管理
│   ├── 80-download.mjs     # 下载闭环（真实落盘 + ffprobe）
│   ├── 85-settings.mjs     # 设置读写
│   ├── 90-hydration.mjs    # SSR 水合一致性
│   ├── 95-a11y.mjs         # 可访问性基线
│   └── 100-auth.mjs        # 鉴权链路（独立实例）
└── reports/                # 每次运行的产物（已 gitignore）
```

---

## 用例清单

用例 ID 格式 `E2E-<模块>-<序号>`，**跨版本稳定**，便于对比历史报告。

| 模块 | tag | 覆盖 | 依赖 |
|---|---|---|---|
| 骨架与导航 | `smoke` | 5 个导航、底部导航按端显隐、无横向溢出、四个页面可打开、设置 tab | 无网络 |
| 搜索与聚合 | `search` | 搜索结果、工具栏计数、切平台、单曲↔专辑、详情面板、全选/清空 | 上游搜索 |
| 入队与重复裁决 | `enqueue` | 库内歌触发裁决并取消解锁、库外歌入队进队列 | 上游搜索 + 网络下载 |
| 下载队列 | `queue` | 三分组、音质筛选、批量操作栏、清理重复弹窗、记录跨分类检索、刷新 | 快照数据 |
| 歌单页 | `playlist` | 工具栏齐全、链接输入驱动按钮解禁 | 无 |
| 音源管理 | `sources` | 列表、新增抽屉、编辑预填（PC 直点 / 移动端 `···` 菜单）、启停写库还原 | 快照音源 |
| 下载闭环 | `download` | 到终态、文件存在、体积合理、ffprobe 可解码（时长/码率/声道） | 上游 + 网络 + ffprobe |
| 设置读写 | `settings` | 分类遍历、并发数保存生效并还原 | 无 |
| 水合一致性 | `hydration` | 5 页 × 2 轮零水合告警、设置页首屏文案不闪动 | 无 |
| 可访问性基线 | `a11y` | 按钮/链接有名、表单有标签、触控目标、整页横向滚动、地标 | 无 |
| 鉴权链路 | `auth` | 未登录 401/跳转、错误口令、指数退避 429、登录、会话、退出失效 | 独立实例 |

**级别**：`P0` 阻塞发版、`P1` 应修、`P2` 观察项。报告里逐条标注。

---

## 运行参数

| 参数 | 说明 |
|---|---|
| `--only=tag1,tag2` | 只跑指定模块（逗号分隔） |
| `--profile=pc\|mobile\|both` | 端，默认 both |
| `--base=http://...` | 复用已启动的服务，不再拉起隔离实例 |
| `--headed` | 有头模式 |
| `--bail` | 首个失败即停 |
| `--keep` | 保留临时数据目录（排障用） |
| `--list` | 列模块 |

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `E2E_PORT` | `18990` | 隔离实例起始端口（被占自动 +1） |
| `E2E_AUTH_TOKEN` | 空 | **主实例**鉴权口令；空 = 关闭鉴权（与被测默认一致）|
| `E2E_AUTH_PROBE_TOKEN` | `e2e-probe-pass` | 鉴权模块专用实例口令 |
| `E2E_SEARCH_KEYWORD` | `周杰伦` | 搜索关键词，上游波动时可换 |
| `E2E_MAX_DOWNLOADS` | `1` | 每端最多真实入队几首 |
| `E2E_DOWNLOAD_TIMEOUT_MS` | `180000` | 单任务等待上限 |
| `E2E_BROWSER_CHANNEL` | `chrome` | 浏览器 channel；置空则用自带 chromium |
| `PLAYWRIGHT_PATH` | — | 显式指定 playwright 包路径 |

---

## 数据隔离（重要）

套件**不会**写你的真实曲库：

1. 用 `VACUUM INTO` 从 `data/miyin.sqlite` 生成一致性快照到临时目录（失败则降级为文件复制）。
2. 把快照里 `settings.app.downloadDir` 改指临时 `downloads/`。
3. 一并复制 `data/sources/`，保证音源页有数据。
4. 跑完删除临时目录（`--keep` 保留）。

快照**带真实存量数据**，所以「已在库 / 重复裁决 / 记录检索」这类用例能生效；
若你的库是空的，这些用例会自动 SKIP 而不是失败。

> ⚠️ 鉴权模块会 `delete from settings where key='auth_token_override'`。
> 因为该键优先级**高于环境变量**，且空字符串表示"刻意关闭鉴权"——
> 真实库里通常就是 `{"token":""}`，不清掉的话传了 `AUTH_TOKEN` 也照样免鉴权。

---

## 报告

每次运行写到 `e2e/reports/<时间戳>/`：

```
report.md          # 人/AI 读：总览 + 失败明细 + 每端用例表 + 诊断
report.json        # 机器读：cases[]（id/severity/status/ms/detail/evidence）
shots/*.png        # 每步截图（失败时最有价值）
server-main.log    # 被测服务 stdout（含 [download]/[upstream] 前缀日志）
server-auth.log
```

`report.json` 的 `cases[]` 是稳定的机器接口，可直接用于「对比两次发版差异」：

```js
const prev = readJson('e2e/reports/A/report.json')
const curr = readJson('e2e/reports/B/report.json')
const regressed = curr.cases.filter(c => c.status === 'fail' &&
  prev.cases.find(p => p.id === c.id)?.status === 'pass')
```

---

## 选择器约定与坑

所有选择器集中在 `selectors.mjs`。改 UI 后**只改那一处**。已知陷阱：

- **行内选择器必须相对**。`songRowCheck` 是全局 `.song-list .row-check`，
  拿它做 `row.locator(...)` 会变成"在行内找后代 `.song-list`"，永远匹配不到。
  行内用 `songRowCheckIn: '.row-check'`。
- **分组 tab 没有 `role=tab`**，全是 `.tabs > .tab`。搜索页平台 tab 取**最后一个** `.tabs`；
  设置页用 `[aria-label="设置分类"] .tab` 区分。
- **弹窗分两层**：外层 `.overlay[role=presentation]`，内层 `[role=alertdialog]` / `[role=dialog]`。
  判断"弹窗出现"用内层语义角色；点遮罩用外层。
- **音源抽屉不支持 Esc**，只能按"取消"关闭；移动端编辑入口在 `···` 菜单里（`role=menuitem`）。
- **歌曲列表是虚拟列表**：首行出现时行数还在涨、节点会复用重建。
  必须 `waitForTimeout` 等一拍再操作，点击要允许失败后重定位重试。

---

## 新增用例

在 `specs/` 下新建 `NN-tag.mjs`（`NN` 决定顺序），模板：

```js
import { sel } from '../selectors.mjs'

export const meta = {
  tag: 'mytag',            // --only=mytag
  title: '中文模块名',
  order: 55,               // 决定执行顺序
  profiles: ['pc', 'mobile'],
  // singleRun: true,      // 只跑一次（不按端重复）
  // needsAuthServer: true,// 需要独立鉴权实例
}

export default async function run(t, ctx) {
  const { page, base, api, isMobile, state } = ctx
  t.setPhase('/mypage')     // 后续控制台错误会带这个上下文

  await t.assert(
    'E2E-MYTAG-01',         // 稳定 ID，别复用已删除的 ID
    '用例名称（动词开头）',
    async () => {
      await page.goto(base + '/mypage', { waitUntil: 'domcontentloaded' })
      const n = await page.locator(sel.someThing).count()
      if (n === 0) throw new Error(`期望 >0，实际 ${n}`)   // 抛错即 FAIL
      return `实际 ${n} 个`                                 // 返回值进报告的 detail 列
    },
    { severity: 'P0', evidence: [await t.shot(page, 'mypage')] },
  )
}
```

规则：

1. **一条用例只验一件事**，失败信息要能直接指导定位（写"期望 X，实际 Y"）。
2. **不要断言会变的数字**（条数、毫秒），断言"关系"（>0、不变、包含）。
3. **依赖外部数据的用例要能 SKIP**：先用 `api.get(...)` 预检，没数据就 `t.skip(...)` 并说明原因。
4. **改代码前先想"这条失败是真缺陷还是我的假设错了"**。本套件开发时
   7 次「疑似缺陷」里有 5 次是测试自己的选择器/时序假设错了。
5. 模块之间**只通过 `ctx.state` 传数据**（如 enqueue 把任务 id 交给 download），不共享页面状态——
   每个模块跑在独立 BrowserContext 里。

---

## 稳定性设计（为什么这么写）

| 设计 | 原因 |
|---|---|
| 每模块独立 BrowserContext | 上一条用例留下的详情面板/弹窗会让下一条假失败（实测踩过） |
| 上游预检 + SKIP | 上游波动很常见，不能算产品缺陷；报告里 SKIP 与 FAIL 分开统计 |
| 限流用例用 800ms 间隔 | 服务端是指数退避（1s→2s→4s），间隔 2s 以上会"刚好每次放行"，看不到 429 |
| 鉴权模块单跑 | 限流是进程内状态，跑两遍会互相干扰；且跑完实例即弃 |
| 虚拟列表等一拍再点 | 列表首行出现 ≠ 列表渲染完成，节点会被回收重建 |
| 默认 `channel=chrome` | 自带 chromium 在无头下偶发 broker 断连（本机实测） |
| 设置/启停用例自带还原 | 否则污染快照，下次运行结论不可比 |

---

## 已知限制

- **不做并发压测**：单用户 NAS 应用，重点是正确性。
- **不验证真实播放**：`usePlayer` 依赖浏览器音频解码，无头下不可靠。
- **上游可用性不可控**：搜索/下载相关用例在断网时会 SKIP 或失败，先看报告里的 `diag`。
- **不覆盖飞牛子路径部署**：`baseURL=/app/miyin/` 的鉴权回归在 `tests/auth.test.ts` 里做（更快更准）。
- **没有 CI 集成**：需要真实网络与 Chrome，建议发布流程里手动跑或放在 release 脚本前置检查。

---

## 发版前检查清单

```bash
pnpm test                                    # 1. 单元/集成必须全绿
pnpm build                                   # 2. 构建
pnpm test:e2e                                # 3. E2E 全量
```

通过标准：

- `pnpm test` 无 FAIL。
- E2E 报告里 **无 P0 失败**；P1 失败需逐条确认是否为已知项。
- `hydration` 模块 0 告警（历史上它抓到了最难发现的一类问题）。
- `download` 模块的 ffprobe 用例 PASS（这是"落盘的是不是真音频"的唯一端到端证据）。
