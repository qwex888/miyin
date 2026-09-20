## [0.5.2] - 2026-09-20

### Fixed

- 单曲与批量入队接口校验音质枚举，非法音质直接拒绝，不再产生必然失败的下载任务 (@qwex888)

- 歌单匹配对全括号标题、空歌手段的候选不再误加分，降低匹配错曲概率 (@qwex888)

- 取消下载任务后，取链/写元数据等滞留流程不再把任务复活为运行或完成状态 (@qwex888)

- 开启口令鉴权但未配置 SESSION_SECRET 时，会话密钥改为启动期随机生成，不再回退到固定默认值，防止伪造会话 (@qwex888)

- 修复下载后封面嵌入：`metadataService` 漏导 `readFileSync`，封面 JPEG 转换结果校验抛错被吞掉，导致有 `img` 的曲目只写了标签却没有内嵌封面
- 酷我 / QQ 搜索与专辑详情、以及歌单直通入队时，会把封面写入 `musicInfo.img`，下载后可正确嵌入专辑封面
- 检查到应用有新版本后，设置导航红点与版本旁「有更新」提示会正确保留；仅「忽略此版本」会隐藏提醒（「稍后再说」只关弹窗）
- 首次进入应用（已登录或开放模式）会自动请求更新检查并显示设置角标；登录成功后也会补检

### Added

- 单曲搜索结果支持多选批量下载，可全选已加载结果或逐条勾选后一次入队（超过 100 首需二次确认） (@timor-m)


---

## 技术溯源

完整对比：[v0.5.1...v0.5.2](https://github.com/qwex888/miyin/compare/v0.5.1...v0.5.2)

### Commits

- [`eb9cf96`](https://github.com/qwex888/miyin/commit/eb9cf96e4f363183bb9e86303afe7a4329a1af5b) test(flacCover): 自动剥离测试样本的原有封面 _(qwex888)_
- [`cb6fe1f`](https://github.com/qwex888/miyin/commit/cb6fe1fba1e71b8094ad6909d1fe56eaa8249f06) build(package.json): 将版本从0.5.0恢复至0.5.1 _(qwex888)_
- [`c30d517`](https://github.com/qwex888/miyin/commit/c30d517d6abc2e8039f30ffd61644f3ce8e9e9ff) feat(download): 新增单曲搜索批量多选下载，修复多项核心问题 _(qwex888)_
- [`fa50d80`](https://github.com/qwex888/miyin/commit/fa50d801a467b9c924a64bdb001d1dc6602eedc4) fix(metadata): 修复专辑封面嵌入失败的问题 _(qwex888)_
- [`b80ea96`](https://github.com/qwex888/miyin/commit/b80ea96692b8269b906507a800830060cbd251eb) fix: 修复更新提醒异常、补全音乐封面并优化更新流程 _(qwex888)_
