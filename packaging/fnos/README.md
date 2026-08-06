# 飞牛 fnOS Native FPK 打包

觅音以 **Native 应用**（Node.js + 统一网关 Unix Socket）交付。

指南：[Native 应用案例](https://developer.fnnas.com/docs/examples/native/) · [用户向导](https://developer.fnnas.com/docs/core-concepts/wizard/) · [环境变量](https://developer.fnnas.com/docs/core-concepts/environment-variables/)

## 对外访问与端口

当前包走 **统一网关**，用户访问 `https://<NAS>/app/miyin`（或飞牛桌面 iframe），**没有独立的对外 Web 端口**：

- 安装时飞牛**不会**让你选网页端口，向导里也不提供端口项
- `cmd/main` 内的 `18980` 仅供本机 Nitro ↔ Socket 反代，不对外暴露
- 本地开发 / Docker 默认监听 `18980`（已避开常见的 3000）

若将来需要 `http://IP:端口` 直连，需另行声明 `service_port`（与网关模式不同）。

## 安装向导

| 字段 | 说明 |
|------|------|
| `wizard_auth_token` | 访问口令 → `AUTH_TOKEN`（**选填**；留空=开放模式） |
| `wizard_download_mode` | `default`（共享目录 `miyin/downloads`）或 `custom` |
| `wizard_download_dir` | 自定义绝对路径（仅 custom） |
| SESSION_SECRET | **安装时自动生成**，配置变更时保留 |

装后可在应用设置中再次打开配置向导（`wizard/config`）。

## 双架构（D2 胖包）

`platform=all`。`better-sqlite3@13+` 的 npm 包自带 `prebuilds/linux-x64.node` 与 `linux-arm64.node`，运行时按 CPU 自动加载，一份 `.fpk` 通吃 x86 / ARM。

## 目录

```
packaging/fnos/
  server-entry.mjs
  scripts/build-fpk.sh
  miyin/
    manifest
    wizard/install | config
    cmd/main + 生命周期脚本 + lib_config.sh
    config/privilege | resource
    app/ui/...
    app/server/   # build-fpk.sh 生成
```

## 构建

```bash
chmod +x packaging/fnos/scripts/build-fpk.sh packaging/fnos/miyin/cmd/*
./packaging/fnos/scripts/build-fpk.sh
```

需要：Node ≥ 22、pnpm、网络（拉取双架构 prebuild）、`fnpack`。
