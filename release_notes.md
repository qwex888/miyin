## [0.3.0] - 2026-08-08

### Added

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

