## 摘要

<!-- 用户可感知的变化；若仅内部重构也请一句话说明 -->

## 变更类型

- [ ] 新功能
- [ ] Bug 修复
- [ ] 性能 / 内存 / 稳定性
- [ ] 飞牛 FPK / 安装向导 / 开放 API / 鉴权
- [ ] 依赖或 CI
- [ ] 其他

## 检查清单

- [ ] 已本地运行 `pnpm test` 与 `pnpm build`
- [ ] 已更新根目录 `CHANGELOG.md`（`[Unreleased]` 用户可见摘要；可选 @用户/PR #；**不写 commit SHA**）
- [ ] 未提交 `.env`、密钥、`*.fpk`、`packaging/fnos/bin/*.exe` 等二进制
- [ ] 若改 `manifest` / `os_min_version` / `api-scope`，已核对向导与 packaging 文案
- [ ] **来自 fork 的首个 PR**：已在 GitHub Checks 区点击 **Approve and run workflows**（否则 CI 不会跑）

## 测试说明

<!-- 如何验证；fnOS 真机 / 大歌单 / 下载队列等 -->

## Breaking changes

<!-- 无则写「无」 -->
