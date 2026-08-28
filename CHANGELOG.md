# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
