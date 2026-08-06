# 觅音 Miyin

轻量音乐下载助手：多源搜索 → 试听 → 指定音质下载（默认最高）→ 音源管理。

## 快速开始

```bash
cp .env.example .env
pnpm install
pnpm dev
```

浏览器打开 http://localhost:3000 ，默认口令 `changeme`（可用 `AUTH_TOKEN` 修改）。

## 常用命令

```bash
pnpm test      # 单元测试
pnpm build     # 生产构建
pnpm preview   # 预览构建产物
docker compose up -d --build
```

## 一期能力

- 音源批量导入 / 检测 / 清理（洛雪兼容 JS）
- 按平台 Tab 搜索（网易 / 酷我 / 酷狗 / QQ）
- 左列表 + 右详情、试听、入队下载
- 队列：进行中 / 已完成 / 失败，失败换源重试
- 可选歌词、Token 鉴权、设置页

## 说明

- 洛雪音源脚本主要用于**取直链**；搜索由服务端平台适配完成。
- 与知音弱联动：把「下载目录」设为知音扫描目录即可。
- 飞牛 `.fpk`：见 `packaging/fnos/README.md`（二期）。

## 验收清单

- [ ] 导入音源.txt 并检测
- [ ] 搜索出结果，详情完整
- [ ] 试听可播放，不产生「已完成」任务
- [ ] 下载落盘，可选歌词
- [ ] 失败可换源/重试
- [ ] 无 Token 访问 API 返回 401
