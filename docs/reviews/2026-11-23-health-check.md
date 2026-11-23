# 全仓体检报告（2026-11-23）

范围：`server/` `shared/` `app/` 共 29,796 行（TS/Vue），70 个测试文件 / 504 条用例。
方法：静态走读 + 关键假设实证（起最小 h3 服务验证路径语义、用真实音频验证 ffprobe 参数）。
基线：`main@c4faa39`（本轮合并 #46、#48、#42、#44、#49 之后）。

结论先说：**架构上最关键的几个不变量是做对了的**（CAS 状态机、原子 rename、判重与写入同事务、
筛选 fail-closed）。真正的问题集中在三处「边界」：鉴权路径、外部输入拼路径、以及
**子进程与批量操作没有时间/让出边界**。前者三条已在 PR #51 修掉。

> **第二批修复（本次）**：优先级表的第 3、4、5、6 项已完成 —— 统计改增量计数、批量操作分块、
> 登录限流 + 下载目录错误码细分、SSE 背压。新增用例 `tests/opsHardening.test.ts`（17 条）。
> 剩余未修见第五节（第 2、7、8、9、10 项，以及 3.1 的检索部分）。

---

## 零、本轮已修（PR #51）

| 编号 | 问题 | 类别 | 证据 |
|---|---|---|---|
| S-0 | 子路径部署（飞牛 `/app/miyin/`）下**鉴权整体失效** | 安全 | 实测 h3 1.15.11：`getRequestURL().pathname` = `/app/miyin/api/health`，`startsWith('/api/')` = false → 中间件提前 return |
| S-1 | bundle manifest 的 `sources[].id` 可路径穿越，任意 `.js` 写入 | 安全 | `id` 未校验直接进 `getSourceCachePath(id)` + `writeFileSync` |
| S-2 | 客户端可经 `musicInfo.__replaceOldFile` 删除任意文件 | 安全 | `prepareEnqueue` 裸 spread；成功后 `cleanupReplacedFiles` unlink |
| C-0 | ffprobe / ffmpeg 无超时，可永久占住下载并发槽 | 并发 | spawn 无 timeout、无 kill；`processTask` await 其 promise |

验证：全量 `501 passed / 3 skipped`，`nuxt build` 通过，新增 `tests/securityHardening.test.ts` 10 条。

---

## 一、并发安全

### 1.1【P1·未修】单实例假设没有互斥，双实例会互相踩

`startDownloadWorker()` 启动时无条件把所有 `running` 复位成 `queued`：

```ts
UPDATE download_tasks SET status='queued', progress=0 WHERE status='running'
```

单实例进程崩溃重启时这是正确的（孤儿复位）。但只要有第二个实例（飞牛升级期新旧进程重叠、
dev server 与生产同库、用户误开两份），就会：

1. 新实例把旧实例正在下载的任务改成 `queued`；
2. 旧实例下载完成 → `applyStatusTransition(..., ['running'])` CAS 失败 → 走 `removeFileQuiet(filePath)`，**刚下好的文件被删掉**；
3. 任务被重新下载一遍。

第 2 步是数据丢失 + 带宽浪费的双重结果，且日志里只有一行 `[download]` 都不一定有。
**改法**：启动时在数据目录写 `pid` 锁（`<dataDir>/worker.lock`，`O_EXCL` + `process.kill(pid,0)` 探活），
拿不到锁的实例只提供 API 不启动 worker；或把 worker 收进独立进程。工作量约半天，建议做。

### 1.2【P1·已修】批量操作是同步循环，万级记录会卡住事件循环

`batchDeleteTasks` 是唯一做了分块的（200/块 + `setImmediate`），其余四个仍在单次 tick 里跑完：

```ts
for (const id of targetIds) { try { items.push(cancelTask(id)) } catch ... }
```

`cancelTask` 内部是 `getTask` + `UPDATE` + `removeTaskFiles`（含多次 `unlink`）+ `emitTask`（又一次 SELECT）
≈ 4~5 次同步操作/条。1 万条 ≈ 4~5 万次同步调用，事件循环阻塞秒级：SSE 心跳被推迟、
下载进度不刷新、其他请求排队。当前 UI 一次最多操作一页（200 条），但「全选」是跨分页全量语义，
筛选宽泛时很容易命中几千条。
**已修**：抽出 `forEachChunked(items, 200, fn)`（块间 `setImmediate`），`batchCancelTasks` /
`batchRetryTasks` / `batchSwitchQualityAndRetry` / `batchSwitchSourceAndRetry` 四个批量函数
改为异步并共用它（删除路径原本就是分块的）。API 路由直接 `return` promise，无需改动。
副作用是 `await` 会让出一个事件循环轮次，因此单测里真实 worker 会抢先去下载 —— 新增
`MIYIN_DISABLE_WORKER=1` 关闭「写入后自动唤醒」，需要真实处理的用例显式调 `tickWorker()`。

### 1.3【P2·未修】`tickWorker` 的 `isTicking` 会丢唤醒

`tickWorker` 全程无 `await`（同步到底），`kickWorker()` 撞上 `isTicking === true` 就直接 return，
唤醒丢失。触发路径很窄但真实：`processTask` 在第一个 `await` 之前就 `return`（任务已被取消 /
`getTask` 为空）时，`void queue.add` 的 `finally` 会在**同一次 tick 内**跑完并 `kickWorker()` ——
此时 `isTicking` 仍是 true，这次唤醒被吞，只能等 8 秒后的 interval 兜底。
**改法**：加 `let tickAgain = false`；`kickWorker` 命中 `isTicking` 时置位，`finally` 里若为真再跑一次。

### 1.4【P2·已修】SSE 没有背压

`server/api/downloads/events.get.ts` 直接 `res.write()`，不检查 `res.write()` 返回值，
也不监听 `drain`。客户端休眠 / 后台标签页 / 网络中断不 FIN 时，Node 会在
`res.writableBuffer` 里无限累积（进度事件每任务最多 4 次/秒 × 并发数）。10 个卡住的连接配 5 并发，
一小时就是几百 MB。`setMaxListeners(50)` 只是把警告压掉，不解决内存。
**已修**：抽出 `server/utils/sseWriter.ts`（可单测）：`writableLength > 1MB` 时丢帧，
连续丢 500 帧判定对端已死并 `destroy()`；同时补上 `res.on('error')` 收尾，避免写失败后
事件总线上仍挂着指向已死响应的回调。

### 1.5【P2·未修】`getTask(id)!` 的非空断言

`enqueueDownloadChecked` 各分支都 `return { task: getTask(prepared.id)! }`。同一 tick 内被并发请求
`deleteTask` 掉时（HTTP 并发），`getTask` 返回 `undefined`，接口 200 返回 `task: undefined`，
前端 `task.id` 直接抛。概率低但属于「能修就修」的形态：换成 `?? throw createError(404)` 或
把 insert 结果直接返回。

### 1.6 做对了的部分（不要改）

- **状态机全部 CAS**：`applyStatusTransition(id, patch, fromStatuses)` → `WHERE id=? AND status IN (...)`，
  `cancelled` 是终结态，worker 任何回写都不会复活已取消任务。提交阶段 CAS 未命中会主动删掉刚落盘的文件，
  这条比「先检查再写」强得多。
- **落盘原子性**：先 `<name>.part.<ext>`，校验魔数后 `renameSync`；临时文件在 catch 里清理；
  `downloadFile` 自己 on-error unlink 半截文件（所以「换候选时旧 .part 泄漏」这条**不存在**）。
- **判重 + 写入同事务**：`db.transaction(() => { findDuplicates(); insertTaskRow() })`，better-sqlite3 同步执行，
  并发的另一次入队只会在事务前（被检出）或事务后（检出本次），没有中间窗口。

---

## 二、错误处理

### 2.1【P1·未修】`restoreReplacePaths` 静默吞掉解析失败，会留下孤儿文件

```ts
try { musicInfo = JSON.parse(task.music_info_json || '{}') } catch { return null }
```

`music_info_json` 一旦损坏（历史脏数据、手工改库），替换任务取消时 `file_path` 被写成 `null`，
而旧文件还在磁盘上 —— 记录说「没有文件」，用户再也找不到它，也不会被清理。
**改法**：解析失败打 `warn` 并退回 `task.file_path`（即便为 null 也至少留日志），或对
`music_info_json` 做一次启动期体检。

### 2.2【P2·已修】下载目录权限错误文案失真

`assertDownloadDirWritable` 把**所有非 ENOSPC 的异常**都报成「无下载目录写入权限」。
磁盘满、只读挂载、路径不存在、SELinux 拒绝，用户看到的都是同一句「请检查卷挂载与目录属主」。
**已修**：`describeDownloadDirFailure(code, path)` 按 `ENOSPC`（空间不足）/ `EROFS`（只读挂载）/
`EACCES|EPERM`（无写入权限）/ `ENOENT`（路径不存在）/ `ENOTDIR`（同名文件占位）/ `EDQUOT`（配额）
分别给可执行建议；同时 `err.code` 透出**真实 errno**（原来统统改写成 `EACCES`，调用方无法分流）。
`isDownloadPermissionError` 相应把 `ENOENT` / `ENOTDIR` 归入「本地环境类错误」—— 不换源、不重试。

### 2.3【P2·未修】`processTask` 外层 catch 只假设 Error

```ts
const e = err as { message?, code?, name?, hasMore? }
let msg = e?.message || String(err)
```
抛出字符串或非 Error 对象时 `msg` 会变成对象字符串，`e.code` 恒空 → 归类成不可重试。
当前内部只抛 `Error`，属「防御性缺失」，不阻塞。

### 2.4【P3】校验风格不统一

`zod` 只出现在 `server/api/fnos/*` 两处，其余路由是 `readBody<T>()` 裸断言 + 手写 `if`。
`readBody` 返回 `any`，类型断言在运行时不做任何检查（例如 `settings/index.put.ts` 直接信任 body）。
`settingsService` 的 `AppSettingsSchema` 已经在做真实校验，路由层保持现状问题不大，
但**新增路由建议统一走 zod**，避免下一个人照着两套写法各抄一半。

### 2.5 做对了的部分

- `applyStatusTransition` 失败不广播事件（`info.changes === 0` 直接 return），避免脏数据推到前端；
- 歌词抓取失败降级为 `null`（可选产物，不该拖垮下载）；
- 批量删除「先删记录、再删文件」，且失败条目按条回传；
- 批量接口的筛选解析 fail-closed（未知字段/空白串/假日期一律 400），这是 #48/#49 刚补齐的关键一环。

---

## 三、性能瓶颈

### 3.1【P1·部分已修】搜索与统计在大库上是全表扫描

- 关键词检索：`search_text LIKE '%token%'`（多 token AND）。前置 `%` 使索引完全失效，
  10 万行时每次查询扫全表 + 逐行 `LIKE`。
- 统计：`SELECT status, count(*) FROM download_tasks [WHERE ...] GROUP BY status`。
  前端在每次下载事件后 **800ms debounce** 就会重新拉一次，带 `q` 时同样是全表扫。

两个一起构成「库越大越卡、越下载越卡」的正反馈。
**统计已修**：新增 `task_stats` 常量表，**由 SQLite 触发器维护**（insert / delete / `UPDATE OF status`），
无筛选的统计查询变成读 5 行常量表。没有把 ±1 写进 `applyStatusTransition`，是因为状态写入有
6 条以上路径（入队、CAS 迁移、取消、重试、批量删除、启动复位），漏一处就会长期偏差；
触发器由数据库保证「主表怎么写都算数」，连外部 sqlite3 手工改库也同步，且进度更新（不含
`status` 列）不产生任何额外写入。首次建表时按现有数据回填一次。

**检索仍是 `LIKE '%kw%'`**（未修）：FTS5 需要额外虚拟表 + 与 `search_text` 的同步策略，
留待第 8 项。

### 3.2【P1·已修】批量操作无分块（同 1.2，性能视角）

### 3.3【P2·未修】列表响应携带整份 `music_info_json`

`listTasks` 是 `SELECT *`，200 行里包含每条的完整上游元数据 JSON。当前样本库平均 266 字节/行，
总响应约 100~200 KB / 次；随曲目元数据变丰富（多音源返回的 `musicInfo` 有几十个字段）会线性膨胀，
而这个响应在 SSE 断线时是 3 秒一次轮询。
**改法**：列表投影出前端真实用到的列（id/title/artist/album/platform/quality/status/progress/…），
`music_info_json` 只在详情/重试需要时单独取。

### 3.4【P2·未修】音源批量检测串行 + 每源固定 2.5 秒

`checkSources` 是串行 `for`，每个源内部 `probeLocalScript` 会 `await settleSourceNetworkErrors(guard)`，
**固定等 2500ms**（等脚本 fire-and-forget 的 `checkUpdate` 落定）。30 个源 = 至少 75 秒纯等待，
再加上加载与探针，用户看到的是「检测半小时不动」。
**改法**：把固定 sleep 换成「空闲判定」——记录最近一次 promise 活动时间，300ms 无新拒绝即返回；
或对 30 个源做小并发（3~4）而不是纯串行。

### 3.5【P3·未修】索引与 PRAGMA 的细节

- worker 取任务：`WHERE status='queued' ORDER BY created_at ASC LIMIT 1`。有 `idx_download_tasks_status`，
  但排序仍需临时排序；大库加复合索引 `(status, created_at)` 可直接命中。
- `cache_size = -2000`（2 MB page cache）+ `mmap_size = 0`：对 NAS 低内存是合理取舍，
  但 10 万行库上全表扫会反复换页。建议提到 8 MB 并加 `busy_timeout = 5000`
  （当前**没有** busy_timeout，任何第二个连接写库都会立刻 `SQLITE_BUSY` 而不是等 5 秒）。
- `updateTask` 每次 `db.prepare(sql)`（进度更新 4 次/秒/任务）。better-sqlite3 的 prepare 不便宜，
  建议按 `patch` 的键组合做语句缓存。
- 分页 `LIMIT ? OFFSET ?` 深翻页是 O(n)，当前页数不大，暂不影响。

---

## 四、安全（除 PR #51 已修的三条）

### 4.1【P2·设计风险】`vm` 不是安全边界

音源脚本在 `createContext` + `runInContext({ timeout })` 里跑，超时能拦住死循环，
但 `vm` 从设计上不隔离宿主：经典逃逸是拿 `this.constructor.constructor('return process')()`。
即**一个恶意音源脚本 = 宿主进程任意代码执行**（能读 `DATA_DIR`、下载目录、发外网请求）。
音源来自用户主动安装的 `.js`，威胁模型上算「用户自己信任的文件」；但如果仓库里出现
「一键安装某音源包」的分发方式，这会变成供应链入口。
**改法**（成本递增）：文档里明确写「音源脚本等价于本机程序，不要安装来路不明的源」；
或 `child_process.fork` 独立进程 + IPC 白名单（能挡大部分逃逸，但 `req` 能力要重新实现）。

### 4.2【P2·已修】登录无失败限流

`/api/auth/login` 用 `safeEqualString` 做常数时间比较（这点是对的），但**没有任何失败计数**。
NAS 常暴露在局域网/内网穿透下，6 位数字口令可被离线爆破脚本在几小时内打穿。
**已修**：`server/utils/loginThrottle.ts`（内存 Map，条目上限 2000）实现指数退避
（失败超过 3 次后 1s→2s→4s…，上限 60s）与 10 次锁定 5 分钟；被限流时返回 429 + `Retry-After`，
且**在口令比较之前**拦截。地址取 socket 而非 `x-forwarded-for`（防止伪造头绕过），
代价是反向代理后共用同一桶 —— 对单用户 NAS 而言，宁可整体等 5 分钟也不留无限试错的路。

### 4.3【P2·设计风险】源脚本可访问内网（SSRF）

脚本拿到的 `req` 能请求任意 URL，包括 `127.0.0.1`、`169.254.169.254`、路由器管理口。
这是「可编程音源」的固有代价，但至少可以：在 `nodeHttpRequest` 里拒绝解析到私有网段的 host
（除非显式配置白名单），并对重定向的每一跳重新校验。

### 4.4【P3】`GET /api/auth/token` 暴露鉴权是否启用

未登录可读（它在 `/api/auth/me` 之外，但被中间件放行列表覆盖了吗？——`/api/auth/token` **不在**放行列表，
所以只有在 open 模式下可读，此时本就没有秘密）。仅记录，不必改。

---

## 五、建议按此顺序处理

| # | 问题 | 影响 | 改法 | 量级 |
|---|---|---|---|---|
| 1 | PR #51：鉴权路径 / 源 ID 穿越 / 内部字段透传 / 子进程超时 | 安全 + 队列卡死 | 已实现，待合 | 已完 |
| 2 | 单实例锁 | 双实例会删掉刚下好的文件 | pid 锁，拿不到锁不启 worker | 0.5 天 |
| 3 | 统计改增量计数 | 大库下每次下载事件都全表扫 | `task_stats` 常量表 + 触发器维护 | **已完** |
| 4 | 批量操作分块让出事件循环 | 万级批量操作卡死 UI 与 SSE | `forEachChunked`，四个批量函数共用 | **已完** |
| 5 | 登录限流 + 错误码细分 | 口令可爆破；磁盘错误文案误导 | 内存限流 + `ENOSPC/EROFS/EACCES/ENOENT` 分开报 | **已完** |
| 6 | SSE 背压 | 卡住的连接吃内存 | `sseWriter`：`writableLength` 上限 + 丢帧 + 连续丢帧断开 | **已完** |
| 7 | 音源检测去掉固定 2.5s | 批量检测慢一个数量级 | 空闲判定替代固定 sleep；小并发 | 1 天 |
| 8 | FTS5 检索 + 列表投影 | 10 万行时搜索卡顿、响应膨胀 | FTS5 虚拟表；`SELECT` 显式列 | 1~2 天（检索部分仍未修）|
| 9 | `tickWorker` 丢唤醒 / `restoreReplacePaths` 吞异常 / `getTask()!` | 低概率体验问题 | 各自几行 | 0.5 天 |
| 10 | 索引与 PRAGMA（`(status,created_at)`、`busy_timeout`、`cache_size`） | 大库边际性能 | 迁移里加索引；PRAGMA 两行 | 0.5 天 |

---

## 六、检查过但没发现问题的部分（避免重复劳动）

- `applyNameTemplate` / `applyFolderTemplate` 的路径段清洗：`/ \ : * ? " < > |` 全部替换，
  `.`/`..` 丢弃，`folderPrefix` 无法逃出下载根目录（这条我专门验过，不是隐患）。
- ffprobe 的 `-show_entries stream=... -show_entries format=duration` 重复传参：**不会**互相覆盖，
  实测两次都是 `duration=3.000000` + `codec_name=flac`，时长解析正确。
- 队列候选探测预算（`PREVIEW_COMBO_CAP` / `probeBudget`）：按音源数封顶，不会因音源多而线性变慢。
- 设置项取值范围（`concurrency` 1~5、`maxAttempts` 1~8）由 zod 兜住，不存在「把并发调成 1000」的入口。
- 歌词抓取、上游通道、封面下载均有显式超时（12s / 10s / 20s）。
- 判重键版本迁移（`DEDUP_KEY_VERSION`）与回填分批：可中断可续，批间让出事件循环。
