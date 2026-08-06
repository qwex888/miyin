# 飞牛 fnOS Native FPK 打包

觅音以 **Native 应用**（Node.js + 统一网关 Unix Socket）交付，不再使用 Docker Compose。

指南参考：[Native 应用案例](https://developer.fnnas.com/docs/examples/native/)

## 目录

```
packaging/fnos/
  server-entry.mjs          # Socket 反向代理入口
  scripts/build-fpk.sh      # 构建脚本
  miyin/
    manifest
    ICON.PNG / ICON_256.PNG
    cmd/main                # start/stop/status
    config/privilege
    config/resource         # data-share: data + downloads
    app/ui/config           # gateway /app/miyin + app.sock
    app/ui/images/
    app/server/             # 构建产物（.output + start.mjs）
```

## 构建

```bash
chmod +x packaging/fnos/scripts/build-fpk.sh packaging/fnos/miyin/cmd/main
./packaging/fnos/scripts/build-fpk.sh
```

需要：

- Node.js ≥ 22、pnpm
- 飞牛 `fnpack`（若本机没有，脚本仍会准备好 `app/server`，再到飞牛环境执行 `fnpack build`）
- **运行时依赖：ffmpeg**（写入标题/歌手/专辑/封面/内嵌歌词）。未安装则跳过元数据写入，不影响音频下载本身。

## 运行时环境变量

| 变量 | 说明 |
|------|------|
| `SOCKET_PATH` | `${TRIM_APPDEST}/app.sock` |
| `GATEWAY_PREFIX` | `/app/miyin` |
| `DATA_DIR` / `DOWNLOAD_DIR` | 来自 `TRIM_DATA_SHARE_PATHS` |
| `AUTH_TOKEN` / `SESSION_SECRET` | 鉴权（可在安装后配置） |

本地 Docker（`Dockerfile` / `docker-compose.yml`）仍可用于非飞牛部署，与 FPK 无关。
