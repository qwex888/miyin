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

## Pull Request

1. 从最新 `main` 开分支
2. 改动尽量聚焦；附带必要测试
3. PR 描述说明动机与验证方式
4. 用户可见行为变更请同步更新 `CHANGELOG.md`（`[Unreleased]` 段）

## 约定

- 提交信息建议 Conventional Commits（如 `feat:` / `fix:`）
- 勿提交 `.env`、本地 `data/`、`downloads/`、密钥
- 音源脚本版权归原作者；仓库不捆绑第三方音源内容
