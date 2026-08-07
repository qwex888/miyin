## [0.2.1] - 2026-08-07

### Fixed

- CI：适配 pnpm 11，将 `onlyBuiltDependencies` 迁移为 `pnpm-workspace.yaml` 的 `allowBuilds`，修复 `ERR_PNPM_IGNORED_BUILDS`

### Changed

- `main` 分支规则：合入 PR 必须通过 `test-and-build`；发版工作流先跑同一套检测再推镜像 / 打 FPK
- 新增 `pnpm release` / `scripts/release.sh` 一键打 tag 触发 Docker + FPK Release

