#!/usr/bin/env bash
# PR 策略检查：禁止二进制/超大文件；业务代码变更须动 CHANGELOG
# 在 GitHub Actions pull_request 中运行；本地可：GITHUB_BASE_REF=main bash scripts/ci-check-pr.sh
set -euo pipefail

MAX_BYTES=$((5 * 1024 * 1024)) # 5 MiB

if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch origin "${GITHUB_BASE_REF}" --depth=1 2>/dev/null || git fetch origin "${GITHUB_BASE_REF}"
  DIFF_RANGE="origin/${GITHUB_BASE_REF}...HEAD"
else
  if git rev-parse origin/main >/dev/null 2>&1; then
    git fetch origin main --depth=1 2>/dev/null || true
    DIFF_RANGE="origin/main...HEAD"
  else
    DIFF_RANGE="HEAD~1...HEAD"
  fi
fi

fail() {
  echo "❌ $1" >&2
  exit 1
}

needs_changelog=false
changelog_touched=false

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    app/*|server/*|shared/*) needs_changelog=true ;;
  esac
  [ "$f" = "CHANGELOG.md" ] && changelog_touched=true
done < <(git diff --name-only "${DIFF_RANGE}" 2>/dev/null || true)

while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [[ "$f" =~ \.(exe|dll|dylib|bin)$ ]]; then
    fail "禁止提交二进制：$f（请改用 CI 安装或文档说明，勿 vendoring exe）"
  fi
  if [[ "$f" == packaging/fnos/bin/* ]]; then
    fail "禁止向 packaging/fnos/bin/ 新增文件：$f"
  fi
  if [ -f "$f" ]; then
    size=$(wc -c <"$f" | tr -d ' ')
    if [ "$size" -gt "$MAX_BYTES" ]; then
      fail "新增文件过大（>${MAX_BYTES} bytes）：$f"
    fi
  fi
done < <(git diff --name-only --diff-filter=A "${DIFF_RANGE}" 2>/dev/null || true)

if [ "$needs_changelog" = true ] && [ "$changelog_touched" = false ]; then
  fail "变更 app/、server/ 或 shared/ 时须更新根目录 CHANGELOG.md（写在 [Unreleased] 下）"
fi

echo "✓ PR 策略检查通过"
