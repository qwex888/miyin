## [0.5.1] - 2026-09-15

### Added

- 试听栏展开/收起按钮在播放中会显示轻微边框波纹动效，便于识别当前正在试听 (@qwex888)

- 试听栏全局显示（切换页面保持播放），支持收起/展开、底部留白防遮挡，以及可拖动进度条；展开/收起为仅箭头样式 (@qwex888)

- 专辑下载可勾选「按文件夹归档」并配置文件夹命名（默认 `{album}`，写入服务端设置）；歌单不自动建夹（@larryzbo）

- 搜索页单曲/专辑支持触底自动加载更多（各平台统一每页 30 条）；空页、不满一页或请求失败时停止，避免无限重试 (@Andyong8901)

- 本地可自动下载官方 fnpack（`pnpm download:fnpack` / `pnpm build:fpk`），并同步带版本号的 `.fpk` 到 `dist/`（@timor-m, PR #24）

### Fixed

- 尝试修复 iOS 15 访问页面空白：将 Vite 构建目标设为 `safari15`，以关闭 Nuxt `#entry` importmap（需真机验证）(@qwex888)

- 为 iOS 15.0–15.3 补齐 `Object.hasOwn` / `findLast*` polyfill，避免 Nuxt payload 解析阶段白屏（@timor-m, PR #24）

- 试听取链中展示「取链中…」，切换曲目或关闭时取消上一请求并停止缓冲 (@qwex888)

- 网易/QQ/酷狗歌单解析补全 musicInfo，支持同平台 id 直通入队，避免二次搜索失败导致队列为空；批量入队无可用音源时不再假成功 (@qwex888)

### Changed

- 专辑详情曲目列表改为虚拟滚动（弹性高度 + 最小 400px 兜底），超大合集滚动更顺畅

- 音源更新提示整条可点（可一键更新则更新，否则打开说明），并将一键更新/打开说明提到提示旁始终显示；操作列仍保留 (@qwex888)

- 接入 @vueuse/nuxt，底部导航用 useScreenSafeArea 适配多机型安全区 (@qwex888)


---

## 技术溯源

完整对比：[v0.5.0...v0.5.1](https://github.com/qwex888/miyin/compare/v0.5.0...v0.5.1)

### Commits

- [`884edab`](https://github.com/qwex888/miyin/commit/884edab6408827a5ae169a1a60f9136a0c7164bc) feat(release): 优化发版脚本，自动同步精简更新说明到飞牛 manifest _(qwex888)_
- [`fbd0885`](https://github.com/qwex888/miyin/commit/fbd0885f6d5b3f6bfbbc014f7bfae2c39d5db9b5) feat(player): enhance mini player functionality and UI _(qwex888)_
- [`427efe1`](https://github.com/qwex888/miyin/commit/427efe1845fd9611b8c57606ae0f29dffcf449ba) fix(fnpack): 对齐 CLI 版本并兼容 Windows 路径 _(qwex888)_
- [`38fb772`](https://github.com/qwex888/miyin/commit/38fb7729513c555bdf17beec0851a69a393b776e) feat(album): 添加专辑下载按文件夹归档功能 _(qwex888)_
- [`95f0bcf`](https://github.com/qwex888/miyin/commit/95f0bcf0005ee6973bfa0d914092431db39ac77a) feat(fnpack): 自动下载 fnpack CLI 并更新构建脚本 _(timor-m)_
- [`03f4095`](https://github.com/qwex888/miyin/commit/03f4095735327ef4b38716b701fdd29d4801298c) feat(search): 增强搜索功能与专辑详情展示 _(qwex888)_
- [`cba633d`](https://github.com/qwex888/miyin/commit/cba633ddc2026f5ef430f8917c20203372d63c69) fix(ios15): 设置 Vite 构建目标为 safari15 尝试修复 iOS 15 页面空白 _(qwex888)_
- [`3f9b727`](https://github.com/qwex888/miyin/commit/3f9b7279db0ef3c06af2380b5019b773457f114c) feat(update): 增加音源更新提示与一键更新功能 _(qwex888)_
- [`1dde218`](https://github.com/qwex888/miyin/commit/1dde2184dce5c4025c9fcd0b7f75f79d3369dbe1) feat: 支持歌单ID直通入队，修复试听与移动端安全区适配 _(qwex888)_

### 合并提交

- [`94a0bf3`](https://github.com/qwex888/miyin/commit/94a0bf34f41ec047ceab21029127193e263270c5) Merge pull request #24 from timor-m/main _(yocat)_
- [`8c3a5a0`](https://github.com/qwex888/miyin/commit/8c3a5a03e1e9e852375ceae24b8f83806e5d89e0) Merge branch 'main' into main _(yocat)_
