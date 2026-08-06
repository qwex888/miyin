# 飞牛 fnOS FPK 打包（二期）

一期仅遵守约束：配置环境变量化、数据/下载目录可挂载、常驻 Node。

二期参考仓库：`/Users/huangdongliang/code/zhiyin-fnos`

计划步骤：
1. 编写 `manifest` 与图标
2. 使用 Docker Compose / 卷挂载 `DATA_DIR`、`DOWNLOAD_DIR`
3. `fnpack build` 生成 `.fpk`
