# 觅音 Miyin

轻量音乐下载助手：多源搜索 → 试听 → 指定音质下载（默认最高）→ 音源管理。

## 快速开始

```bash
cp .env.example .env
pnpm install
pnpm dev
```

浏览器打开 http://localhost:18980 ，默认口令 `changeme`（可用 `AUTH_TOKEN` 修改）。

## 常用命令

```bash
pnpm test      # 单元测试
pnpm build     # 生产构建
pnpm preview   # 预览构建产物
pnpm build:fpk # 准备飞牛 Native FPK（需 fnpack）
docker compose up -d --build   # 可选：非飞牛 Docker 部署
```

## 能力

- 音源批量导入 / 检测 / 清理（洛雪兼容 JS，沙箱超时/熔断）；同名自动 `(2)`；URL 精确去重
- 按平台 Tab 搜索（网易 / 酷我 / 酷狗 / QQ）
- 左列表 + 右详情、试听、入队下载；封面懒加载
- 队列：进行中 / 已完成 / 失败，SSE 进度，失败可重试
- 歌单导入：网易云 / QQ / 酷狗；多选下载；低分匹配人工确认
- 可选歌词、Token 鉴权、设置页
- 飞牛 **Native** `.fpk`：见 [packaging/fnos/README.md](packaging/fnos/README.md)

## 说明

- 洛雪音源脚本主要用于**取直链**；搜索由服务端平台适配完成。
- **鉴权**：`AUTH_TOKEN` 为空 = 开放模式（无登录、API 免鉴权）；非空则需登录。Docker 示例仍建议设置口令。

## 与知音（Zhiyin Music）的关系

觅音专注「搜得到、下得快」；若你还希望有一个长期可听、可管理的个人曲库，可以搭配同系列的 **[知音 Zhiyin Music](https://github.com/qwex888/zhiyin-music-web)**（NAS 音乐库 + Web 播放器）。

两者是**弱联动、互不绑定**：

1. 在觅音设置里，把「下载目录」指到知音正在扫描的音乐根目录（或其中子目录）
2. 觅音负责多源搜索、试听与落盘（含封面 / 歌词等元数据）
3. 知音增量扫描后即可播放、整理、推荐——无需额外同步插件

不必同时安装；只做下载用觅音即可。已经在用知音管曲库的朋友，把下载目录对齐，往往能少折腾一步。

## 验收清单

- [ ] 导入音源.txt 并检测
- [ ] 搜索出结果，详情完整
- [ ] 试听可播放，不产生「已完成」任务
- [ ] 下载落盘，可选歌词
- [ ] 失败可换源/重试
- [ ] 无 Token 访问 API 返回 401
- [ ] 歌单解析（网易/QQ/酷狗）与选中下载
- [ ] 低分匹配可人工确认
- [ ] `pnpm build:fpk` 可产出可安装包（或准备好 `app/server`）
