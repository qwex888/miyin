# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

**书写约定**

- `[Unreleased]`：只写**用户可感知**的摘要（Added / Changed / Fixed / Removed）；一条 PR 或一项变更一行。
- 可选标注贡献者：`(@GitHub用户名)` 或 `(PR #编号)`；**不要写 commit SHA**（避免 amend/rebase/squash 后失效）。
- 发版时 `pnpm release` / GitHub Release 会从 **git tag 区间**自动生成 commit 溯源，附在 Release Notes，不写入 CHANGELOG 正文。
- 追加条目：`pnpm changelog:add <类型> "描述" [--author 用户名] [--pr 编号]`

## [Unreleased]

### Added

- 歌单解析支持酷我（kw）链接（含 `m.kuwo.cn/newh5app/playlist_detail/{id}`），分页拉全曲目
- 专辑搜索/详情：补充 mock fetch 的 service 与路由等价路径测试（含 kg/kw 分页与硬顶）
- 设置页分为「基础设置 / 访问口令」两个 Tab；访问口令修改（须校验当前口令，可留空切回开放模式）立即生效，无需重启。优先级：应用内设置 > Docker `-e` / 飞牛安装向导；FPK 同步写入 `miyin.env`
- 搜索页支持「单曲 / 专辑」切换：可按专辑名搜索（wy / tx / kw / kg），进入专辑详情后多选或一键整专入队下载
- 单曲详情增加「查看专辑」跳转（携带 albumId 时直达整专曲目列表）
- 专辑/歌单批量入队结果弹窗：失败项按原因分组汇总，支持重试失败项；查看队列时可按 batchId 筛选同批任务
- CHANGELOG 与 Release 分工：`[Unreleased]` 仅用户可感知摘要；发版 Release Notes 自动附 git tag 区间 commit 溯源；新增 `pnpm changelog:add` 辅助写入
- CI：PR 策略检查（禁止二进制/超大文件、业务变更须更新 CHANGELOG）；PR 模板与按路径自动打 label
- 贡献指南：PR 流程、fork 首次需 Approve workflows、分支保护配置说明（合并仍须维护者人工确认）
- 单元测试：新增 `tests/platformSearchVar.test.ts`，覆盖 `wy`、`kw`、`kg`、`tx` 全部 4 个音乐平台的搜索适配器变量声明与返回结构完备性测试
- 队列与健康检查：暴露 `/api/health` 实时内存指标（`rssMb`、`heapUsedMb`、`heapTotalMb`）与 `/api/downloads/stats` 队列聚合统计接口
- 队列失败 Tab：选中任务后可「批量换音质」「批量换源」（全选也可用）；H5 工具栏双列自适应
- 音源批量导入/检测/目录与完整包导入：进度弹窗支持「立即停止」；服务端按项边界中止，已完成项保留

### Changed

- 更新说明弹窗不再附带下载链接
- 登录页与设置页口令输入统一使用显/隐眼睛图标组件
- 登录页访问口令输入框支持显/隐切换（右侧眼睛图标）
- 歌单解析与匹配流程：歌单解析提取曲目基础元信息并保留原始 `musicInfo`，入队与下载支持快速直通通道（`allowManualBypass`）或匹配引擎跨平台解析，避免大歌单发起不必要的强制全量二次搜索
- Benchmark 测试门禁：为高耗时及依赖外部网络的内存/吞吐量基准测试（`tests/realPlaylistMemory.test.ts`、`tests/cleanPlaylistBench.test.ts`、`tests/benchmarkMemory.test.ts`）添加 `describe.skipIf(!process.env.RUN_BENCHMARKS)`，确保默认 CI 与本地单元测试确定性且毫秒级快速通过
- 下载并发与队列调度：采用 `p-queue` 接管任务并发与动态调度，绑定 `AbortController` 信号传递替代旧定时器循环与全局 cancel 集合，流式下载进度广播增加节流控制（250ms / 5% 变化量）

### Fixed

- 酷狗超长歌单曲目偏少：改用 pubsongs `get_other_list_file`（安卓签名）拉全量，避免旧 `special/song` 将 total 截断（如 988→735）
- 酷狗 gcid 分享歌单（如 `m.kugou.com/songlist/gcid_…`）识别失败：改为经 m 站解析 `specialid` 后再拉曲目，避免跟到 www 空壳页
- 酷狗（kg）专辑详情超过单页 500 首时改为分页拉全曲目（硬顶 50 页），避免整专入队被截断；酷我（kw）专辑详情同步分页；网易/QQ 经核查为单次全量接口、请求侧无 pagesize 截断
- 队列页：下载进度 SSE 不再每次触发 `/api/downloads/stats`；仅在任务状态变化时防抖刷新，避免单任务下载时每秒请求数次
- 单元测试：`playlistMatchStream` 入队相关用例改用临时 `DATA_DIR`，避免 `pnpm test` 向开发库 `./data` 写入 `Track N` 假任务污染下载队列
- 服务启动自愈：服务启动时自愈扫描并将残留的孤儿 `status = 'running'` 任务重置为 `queued`，解决应用重启后残留假运行与并发显示不准
- 取消竞态修复：修复下载任务取消与执行调度之间的竞态条件（P1-1），严密校验 DB 状态与 AbortController，防止已取消任务在 processTask 启动或执行中被错误复活为 `running`
- 任务调度分发：优化 p-queue 任务分发机制，入队前保持 queued 状态并增加 tickWorker 互斥锁（P1-2），避免并发数设置较小时 UI 提前显示多条 running
- 跨平台搜索适配器：修复 `server/services/platformSearch.ts` 中 `kw` (id)、`kg` (hash)、`tx` (mid) 的局部变量声明，防止由于变量未定义导致运行时抛出 `ReferenceError`
- 音源沙箱异常治理：重构 `sourceRuntime.ts` 中的异步拒绝守卫（`rejectionGuard`），使用引用计数与局部桶（Bucket）监听器及时解绑与清理引用，消除未捕获 Promise 拒绝导致的 V8 GC Root 内存泄漏
- 仓库治理：彻底移除仓库内提交的平台可执行二进制文件 `packaging/fnos/bin/fnpack.exe`

### Changed

- 全局 viewport 禁止双指缩放（`user-scalable=no`）

## [0.4.3] - 2026-08-28

### Added

- 音源页「更多」支持一键停用所有异常音源（检测失败且仍启用的项，仅停用不删除）
- 音源检测/导入进度遮罩可滚动展示实时 `[source]` 日志；结束后需点确认关闭（列表中的失败摘要仍为短句，不含完整日志）
- 顶栏增加帮助菜单：关于觅音（版本与仓库链接）、问题反馈/建议（跳转 GitHub Issues）
- 应用更新检测：发版时 CI 生成 `latest.json` 并附到 GitHub Release；应用启动后检查更新，设置页显示版本号，有新版本时「设置」导航红点和更新日志弹窗
- 音源检测增加试取链探针：导入/检测时会用固定探针曲目调用 `getMusicUrl`；失败时按 DNS 失败、API 停服、Key 失效、404/500、限流、IP 封禁、脚本需升级等给出针对性 `last_error` 提示

### Changed

- 下载/试听取链：最高可用与固定音质均改为「先按音质档位、再轮询全部音源」；同一档位全部失败后再降档（最高可用）或整体失败（固定音质），避免早停在低音质源

## [0.4.2] - 2026-08-17

### Added

- 音源「更多 → 批量导入目录（JS）」：递归导入目录内全部 `.js`，名称取文件名；同名冲突可选择覆盖或跳过
- 音源批处理实时进度：文本导入 / 目录导入 / 完整包 / 检测 / 清理时展示「当前进度：【n/m】音源：[名称]，状态：…」；单条超时 30s，整批超时 min(5 分钟, 条数×30s)

### Changed

- 布局：窗口不滚动；主内容区（`app-main`）为唯一页面级滚动；首页/音源/队列等一屏内展示，列表在区域内滚动
- 页面 Loading / 导入进度：固定在视口首屏居中（不再随超高内容居中导致要滑很久才看到）
- 单个新增：上传仅支持 1 个 `.js` 文件；同名冲突自动改名为「名称 (2)」…
- 批量脚本上传改为冲突预览（覆盖/跳过），不再自动改名
- 首页试听迷你条：播放/暂停改为可区分状态的图标按钮，并支持关闭（停止播放并清空）

### Removed

- 单个新增弹窗中的「选择目录」入口（改由音源页「更多」批量导入目录）

### Fixed

- 导入冲突弹窗选择覆盖后，进度遮罩被弹窗挡住：Loading 提到弹窗之上，Toast 保持更高层级
- 首页试听迷你条在桌面端被搜索结果封面遮挡（提高 `.mini` 层级）

## [0.4.1] - 2026-08-12

### Fixed

- 生产构建：平台映射改用 Nuxt `#shared` 别名，修复 Nitro 无法解析 `shared/platforms.ts` 导致 `pnpm build` 失败

## [0.4.0] - 2026-08-11

### Fixed

- 首页飞牛授权弹窗：点「去授权」进入设置页后遮罩仍盖住设置；现会关闭弹窗，且仅在首页路由显示
- 歌单列表：KeepAlive 切到队列再返回时虚拟列表空白，需滚动才出现；切回后自动重测可见区
- 歌单入队不再写死「最高可用」：跟随页内音质选择（默认读设置中的默认音质）
- 飞牛/Docker：鉴权与目录改为优先读取进程环境变量 `AUTH_TOKEN` / `DOWNLOAD_DIR`（不再只依赖 Nuxt 的 `NUXT_*` runtimeConfig），安装向导留空口令与自定义下载路径可真正生效
- 安装向导：填写了绝对下载路径但未切换「自定义」时，自动按 custom 写入；`cmd/main` 同步导出 `NUXT_*` 别名
- 退出登录时销毁 KeepAlive 页面实例、断开下载 SSE、释放飞牛 SDK，避免设置页授权 loading 卡住后重登仍残留
- 飞牛开放 API / SDK 失败改为 Toast 提示；授权相关 SDK 调用增加超时，避免遮罩一直转圈

### Added

- 歌词：QQ / 酷我 / 酷狗尽量支持双语；QQ 优先旧 Base64 接口，失败再走 PlayLyricInfo + QRC 解密兜底；酷狗支持 KRC 翻译轨；咪咕在有 lrc/trc URL 时拉取
- 依赖：`qrc-decoder`（MIT，纯 JS）用于 QQ QRC 解密，适配飞牛/Node 无需 native
- 设置：任务启动间隔、下载间隔（秒），用于错开取链 / 上一首结束后冷静再下下一首，减轻音源批量风控
- 歌单页：音质下拉（默认跟随设置，可临时改；不改全局默认）
- 顶栏「刷新」：各页可重新拉取进入时数据（设置/歌词选项/音源列表/队列等），KeepAlive 会话内的搜索结果、歌单预览等操作态仍保留
- 音源：统一新建/编辑弹窗，支持 URL、拖拽/选文件/选目录上传，以及直接编辑本地 JS（含 Key，不落库）
- 音源：导出/导入完整包 zip（`manifest.json` + 脚本）；导入冲突时可选择覆盖或跳过
- 全局 Toast 提示（成功 / 失败 / 警告 / 信息）：顶部居中，适配亮暗色与移动端；队列多任务失败不刷 Toast，仅行内展示
- 页面级 Loading 遮罩（半透明挡交互）：搜索、歌单解析/入队、队列/设置/音源加载与批量操作
- 歌单「匹配确认」改为弹窗（桌面居中 / 移动端底部抽屉），避免沉在页面底部不易发现
- 歌单「入队结果」改为确认式弹窗，可一键跳转下载队列
- 下载队列失败任务支持「换音质」：仅本任务重下，不改全局默认、不记忆选择
- 飞牛 FPK：接入应用共享目录授权（`@trimjs/web-app` + `trim.file.sharedAccess`）；设置页支持「选择并授权目录」「授权当前路径」，首页对未授权自定义目录显示轻提示
- 飞牛：独立浏览器授权回调页 `/fnos-auth-callback`；后端 `GET /api/fnos/dir-auth`、`POST /api/fnos/download-dir`（写入 `miyin.env` 并提示重启）

### Changed

- 设置页歌词说明改为各平台尽量合并双语（不限网易云）；内嵌仍依赖 ffmpeg
- 搜索页音质下拉默认值改为读取设置中的默认音质（仍可临时改）
- QQ 搜索结果写入 `songid`，便于歌词新接口取数字 ID
- 首页飞牛目录未授权提示由顶栏条改为遮罩弹窗（桌面居中 / 移动端底部抽屉），突出「去授权 / 稍后提醒」
- `NuxtPage` 绑定 `pageSession`：会话内仍 keepalive，退出登录后强制重建页面
- 音源列表：移动端行内操作改为「···」展开面板；桌面端仍常显启用/编辑/删除
- 音源列表 URL 固定 80px 宽、最多两行省略显示
- 音源页工具栏收敛为「单个新增 / 删除选中 / 更多」；文本导入、完整包导入导出、检测全部、清理失效收入更多面板；行内保留启用、编辑、删除
- 飞牛 `os_min_version` 提升至 `1.2.0401`，`manifest` 声明 `micro_app=true`；安装/配置向导说明改为引导应用内一键授权（系统应用设置仍为兜底）
- 飞牛桌面 UI 图标 `app/ui/images/icon_{64,128,256}.png` 改为不透明白底，与 `ICON_256.PNG` 一致；`render-brand-assets.sh` 同步默认导出白底
- `.gitignore`：运行时目录改为仅忽略仓库根 `/downloads/`、`/data/`，并忽略本地 `.cursor/rules/`

### Fixed

- 音源检测：按 `/api/sources/check` 返回的 status/error 提示（不可用时错误 Toast，不再一律「检测完成」成功）
- 音源「更多」下拉面板背景改为实色 `var(--surface)`（原先误用 HSL 分量 `--card`，暗色下透明叠字）
- SSR：`@trimjs/web-app` 改为客户端动态导入，避免服务端求值读 `window` 导致路由导航失败（`window is not defined`）
- 下载目录不可写时入队直接返回明确错误「无下载目录写入权限」（含 Docker/飞牛挂载场景的实际写探针）；写入失败任务不再静默/盲目重试
- 飞牛 FPK：`server/api/downloads/**` 曾被 `downloads/` 忽略规则误伤而未打进包，导致 `/api/downloads` 与 SSE `/events` 404、队列始终为空；现已恢复路由纳入版本库

## [0.2.1] - 2026-08-07

### Fixed

- CI：适配 pnpm 11，将 `onlyBuiltDependencies` 迁移为 `pnpm-workspace.yaml` 的 `allowBuilds`，修复 `ERR_PNPM_IGNORED_BUILDS`
- FPK 打包：server 目录改用独立 `npm install`，避免被仓库根 `pnpm-workspace` 吸走导致找不到 `better-sqlite3/prebuilds`

### Changed

- `main` 分支规则：合入 PR 必须通过 `test-and-build`；发版工作流先跑同一套检测再推镜像 / 打 FPK
- 新增 `pnpm release` / `scripts/release.sh` 一键打 tag 触发 Docker + FPK Release

## [0.2.0] - 2026-08-07

### Added

- 开源生产化：GitHub Actions CI / Release、多架构 Docker（Docker Hub + GHCR）、飞牛 FPK 胖包产物、ISSUE 模板、LICENSE / SECURITY / CONTRIBUTING / CHANGELOG
- 飞牛 Native FPK：安装/配置/卸载向导；`AUTH_TOKEN` 选填（空=开放模式）；下载目录默认共享或自定义；卸载可选清除配置与数据（保留已下载音乐）
- 移动端底栏导航；搜索详情底部抽屉；歌单列表行高与歌手信息展示优化
- 下载取链：`highest` 多音源轮询 + 音质阶梯（含 `flac24bit`）；固定音质失败即停并提示原因
- 队列展示音源名称；重试次数语义化文案
- 搜索入队成功后移动端抽屉反馈并自动收起
- README 与知音（Zhiyin Music）弱联动说明

### Changed

- 默认端口 `18980`；默认并发下载数 `1`
- 品牌标识与飞牛图标资源更新

### Fixed

- 酷我搜索伪 JSON / 502；试听片段误判与缺时长兜底
- 下载失败「get url failed」不换源导致成功率偏低（`highest` 路径）

## [0.1.0] - 2026-08-06

### Added

- 一期 MVP：鉴权、音源管理、平台搜索、试听、下载队列、歌单导入、Docker 与 FPK 骨架

[Unreleased]: https://github.com/qwex888/miyin/compare/v0.4.3...HEAD
[0.4.3]: https://github.com/qwex888/miyin/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/qwex888/miyin/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/qwex888/miyin/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/qwex888/miyin/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/qwex888/miyin/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/qwex888/miyin/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/qwex888/miyin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/qwex888/miyin/releases/tag/v0.1.0
