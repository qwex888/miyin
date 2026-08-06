# 飞牛 FPK 骨架

本目录用于后续 `fnpack build`。当前为最小占位：

- `manifest` — 应用元信息
- `app/docker/docker-compose.yaml` — 挂载 DATA/DOWNLOAD 环境变量

## 后续步骤

1. 补充 ICON、cmd 生命周期脚本（参考 `zhiyin-fnos`）
2. 构建并推送 Docker 镜像 `miyin:latest`
3. 在含 fnpack 的环境执行：`cd packaging/fnos/miyin && fnpack build`
4. 飞牛应用中心手动安装生成的 `.fpk`
