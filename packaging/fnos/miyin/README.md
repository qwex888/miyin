# 觅音飞牛 Native 包

完整说明见上级 [README.md](../README.md)。

```bash
# 在仓库根目录
./packaging/fnos/scripts/build-fpk.sh
cd packaging/fnos/miyin && fnpack build
```

安装到 fnOS 后，通过统一网关 `/app/miyin` 访问。

## 运行依赖

- **ffmpeg（必需，用于写入音频元数据/内嵌歌词/封面）**

飞牛或宿主机请先安装 ffmpeg，并保证 `ffmpeg` 在应用进程 PATH 中可用。未安装时下载仍可完成，但会跳过元数据与内嵌歌词写入。
