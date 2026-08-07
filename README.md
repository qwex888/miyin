# 觅音 Miyin

轻量音乐下载助手：多源搜索 → 试听 → 指定音质下载（默认最高）→ 音源管理。

[![CI](https://github.com/qwex888/miyin/actions/workflows/ci.yml/badge.svg)](https://github.com/qwex888/miyin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/qwex888/miyin)](https://hub.docker.com/r/qwex888/miyin)

## 快速开始

```bash
cp .env.example .env
pnpm install
pnpm dev
```

浏览器打开 http://localhost:18980 。`AUTH_TOKEN` 为空为开放模式；设口令则需登录。

## Docker

多架构镜像（`linux/amd64` + `linux/arm64`）发布至 Docker Hub / GHCR：

```bash
docker pull qwex888/miyin:latest
# 或
docker pull ghcr.io/qwex888/miyin:latest

docker run -d --name miyin \
  -p 18980:18980 \
  -e AUTH_TOKEN=changeme \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v "$PWD/data:/data" \
  -v "$PWD/downloads:/downloads" \
  qwex888/miyin:latest
```

或使用仓库内 compose：

```bash
export AUTH_TOKEN=changeme SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up -d
```

## 飞牛 FPK

从 [Releases](https://github.com/qwex888/miyin/releases) 下载 `miyin-v*.fpk`（一份胖包同时支持 x86 / ARM），在飞牛应用中心手动安装。说明见 [packaging/fnos/README.md](packaging/fnos/README.md)。

本地打包：

```bash
# 需安装 fnpack：https://static2.fnnas.com/fnpack/
pnpm build:fpk
```

## 发布（维护者）

1. 在 GitHub → Settings → Secrets 配置：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`
2. 更新 `CHANGELOG.md`（将 `[Unreleased]` 收成新版本段）
3. 打 tag 并推送：

```bash
git tag v0.2.0
git push origin v0.2.0
```

Actions 将自动：跑测试构建、推送多架构镜像、打 FPK 胖包、创建 GitHub Release。

## 常用命令

```bash
pnpm test      # 单元测试
pnpm build     # 生产构建
pnpm preview   # 预览构建产物
pnpm build:fpk # 飞牛 Native FPK（需 fnpack）
docker compose up -d
```

## 能力

- 音源批量导入 / 检测 / 清理（洛雪兼容 JS，沙箱超时/熔断）；同名自动 `(2)`；URL 精确去重
- 按平台 Tab 搜索（网易 / 酷我 / 酷狗 / QQ）
- 左列表 + 右详情、试听、入队下载；封面懒加载；移动端底栏与搜索抽屉
- 队列：进行中 / 已完成 / 失败，SSE 进度；音源名展示；失败可重试 / 换源
- 下载：`highest` 多源轮询 + 音质阶梯（含 flac24bit）；固定音质失败即停
- 歌单导入：网易云 / QQ / 酷狗；多选下载；低分匹配人工确认
- 可选歌词（外挂 / 内嵌）、元数据与封面写入、Token 鉴权、设置页
- 飞牛 **Native** `.fpk` 与 Docker 多架构镜像

## 说明

- 洛雪音源脚本主要用于**取直链**；搜索由服务端平台适配完成。
- **鉴权**：`AUTH_TOKEN` 为空 = 开放模式；非空则需登录。公网部署请设置口令。
- 变更记录见 [CHANGELOG.md](CHANGELOG.md)；贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 与知音（Zhiyin Music）的关系

觅音专注「搜得到、下得快」；若你还希望有一个长期可听、可管理的个人曲库，可以搭配同系列的 **[知音 Zhiyin Music](https://github.com/qwex888/zhiyin-music-web)**（NAS 音乐库 + Web 播放器）。

两者是**弱联动、互不绑定**：

1. 在觅音设置里，把「下载目录」指到知音正在扫描的音乐根目录（或其中子目录）
2. 觅音负责多源搜索、试听与落盘（含封面 / 歌词等元数据）
3. 知音增量扫描后即可播放、整理、推荐——无需额外同步插件

不必同时安装；只做下载用觅音即可。已经在用知音管曲库的朋友，把下载目录对齐，往往能少折腾一步。
