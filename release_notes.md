## [0.5.0] - 2026-09-02

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


---

## 技术溯源

完整对比：[v0.4.3...v0.5.0](https://github.com/qwex888/miyin/compare/v0.4.3...v0.5.0)

### Commits

- [`97681f7`](https://github.com/qwex888/miyin/commit/97681f7468983feb95e0cb61ac914e49c0a4ed4f) feat(playlist): 增强酷狗与酷我歌单解析支持 _(qwex888)_
- [`c7b3812`](https://github.com/qwex888/miyin/commit/c7b3812070d3afb8ba83b692b1554b16b2729024) feat(update): 根据部署环境显示不同的更新指引 _(huangdongliang)_
- [`e21c15e`](https://github.com/qwex888/miyin/commit/e21c15eff3c15280f6f260dd9b3bdc67a4c336c5) feat(auth): 支持应用内动态修改访问口令并立即生效 _(huangdongliang)_
- [`71f3c21`](https://github.com/qwex888/miyin/commit/71f3c21db3187ec74e8cb9532d0abbfa0e44d59c) feat(音源/队列): 增加批量操作支持与进度可停止功能 _(huangdongliang)_
- [`f6fb2de`](https://github.com/qwex888/miyin/commit/f6fb2dedadd0c32b632d2ebc201d615394eddfd7) feat(search): 支持专辑搜索与批量下载功能 _(huangdongliang)_
- [`4bd01d3`](https://github.com/qwex888/miyin/commit/4bd01d3f5e02f8878b143e4796284bd48edd3504) docs: 规范 CHANGELOG 书写并新增辅助脚本 _(huangdongliang)_
- [`b6a1f06`](https://github.com/qwex888/miyin/commit/b6a1f069ee5ec409bbdb85098b21b90e0715a1b2) Merge pull request #10 from wht300/feat/playlist-match-concurrency-stream-cancel _(yocat)_
