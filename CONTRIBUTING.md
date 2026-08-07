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

## 约定

- 提交信息建议 Conventional Commits（如 `feat:` / `fix:`）
- 勿提交 `.env`、本地 `data/`、`downloads/`、密钥
- 音源脚本版权归原作者；仓库不捆绑第三方音源内容
