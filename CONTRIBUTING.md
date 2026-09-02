# Contributing

感谢关注觅音！欢迎 Issue、讨论与 PR。

## 开发环境

- Node.js ≥ 22
- pnpm（推荐通过 `corepack enable`）

```bash
cp .env.example .env
pnpm install
pnpm dev
```

默认开发地址：http://localhost:18980

## 提交前检查

```bash
pnpm test
pnpm build
```

飞牛包本地验证（可选，需 [fnpack](https://developer.fnnas.com/)）：

```bash
pnpm build:fpk
```

## 发版

```bash
pnpm release          # 或 pnpm release -- patch
```

推送 tag 后由 Actions 构建 Docker / FPK，并在 GitHub Releases 上传 `miyin-v*.fpk`。详见 README「发布（维护者）」。

## Pull Request

1. 从 `main` 拉分支，尽量保持 PR 可 review（建议单 PR < 500 行有效 diff；过大请拆分）。
2. 打开 PR 后填写模板；**合并由维护者人工确认**，不会在 CI 通过后自动 merge。
3. **Fork 贡献者**：首个 PR 需在 GitHub PR 页 **Checks** 区域点击 **Approve and run workflows**，否则 CI 不会运行。
4. 变更 `app/`、`server/`、`shared/` 时须同步更新根目录 `CHANGELOG.md`（`[Unreleased]`）：
   - 只写用户可感知摘要；可选 `(@GitHub用户名)` 或 `(PR #编号)`；
   - **不要写 commit SHA**（发版时 Release Notes 会从 git tag 自动生成 commit 列表）；
   - 可用 `pnpm changelog:add Fixed "描述" --author 用户名 --pr 10` 追加条目。
5. 禁止提交 `*.exe` 等二进制及 `packaging/fnos/bin/` 下文件；CI 会拒绝。

维护者合并前请确认：CI 全绿（含 `pr-policy`、`test-and-build`）、至少 1 人 Approve、无未解决的 review thread。

## 约定

- 提交信息建议 Conventional Commits（如 `feat:` / `fix:`）
- 勿提交 `.env`、本地 `data/`、`downloads/`、密钥
- 音源脚本版权归原作者；仓库不捆绑第三方音源内容
