# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 全局 Toast 提示（成功 / 失败 / 警告 / 信息）：顶部居中，适配亮暗色与移动端；队列多任务失败不刷 Toast，仅行内展示
- 页面级 Loading 遮罩（半透明挡交互）：搜索、歌单解析/入队、队列/设置/音源加载与批量操作

### Fixed

- 下载目录不可写时入队直接返回明确错误「无下载目录写入权限」（含 Docker/飞牛挂载场景的实际写探针）；写入失败任务不再静默/盲目重试

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

[Unreleased]: https://github.com/qwex888/miyin/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/qwex888/miyin/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/qwex888/miyin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/qwex888/miyin/releases/tag/v0.1.0
