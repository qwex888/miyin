# 觅音飞牛 Native 包

完整说明见上级 [README.md](../README.md)。

```bash
./packaging/fnos/scripts/build-fpk.sh
# 或：cd packaging/fnos/miyin && fnpack build
```

安装后通过统一网关 `/app/miyin` 访问（无独立对外端口）。安装向导配置访问口令与下载目录；`SESSION_SECRET` 自动生成。卸载时可选择保留或删除配置与数据（含下载队列库）；已下载音乐始终保留。

## 运行依赖

- **nodejs_v22**
- **ffmpeg（建议）**：元数据/封面/内嵌歌词
