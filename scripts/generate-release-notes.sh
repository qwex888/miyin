#!/usr/bin/env bash
# 从 CHANGELOG.md 抽取指定版本摘要，并附加 git tag 区间的 commit 溯源（Release Notes 用）
# 用法: ./scripts/generate-release-notes.sh <version> [out.md] [prev_version]
#   prev_version 省略时：发版 tag 已存在则用 git describe；否则用 git tag 中上一版本
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
OUT="${2:-$ROOT/release_notes.md}"
PREV_VERSION="${3:-${PREV_VERSION:-}}"
REPO="${GITHUB_REPOSITORY:-qwex888/miyin}"
REPO_URL="https://github.com/${REPO}"

if [ -z "$VERSION" ]; then
  echo "用法: $0 <version> [out.md] [prev_version]" >&2
  exit 1
fi

CHANGELOG="$ROOT/CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
  echo "缺少 CHANGELOG.md" >&2
  exit 1
fi

# 抽取 ## [VERSION] ... 直到下一个 ## [
awk -v ver="$VERSION" '
  BEGIN { printing=0 }
  $0 ~ "^## \\[" ver "\\]" { printing=1; print; next }
  printing && $0 ~ /^## \[/ { exit }
  printing { print }
' "$CHANGELOG" >"$OUT"

if [ ! -s "$OUT" ]; then
  {
    echo "## 觅音 v${VERSION}"
    echo
    echo "详见 [CHANGELOG.md](${REPO_URL}/blob/main/CHANGELOG.md)。"
  } >"$OUT"
fi

# --- git commit 溯源（仅 Release Notes，不写入 CHANGELOG 正文）---
resolve_prev_version() {
  if [ -n "$PREV_VERSION" ]; then
    echo "$PREV_VERSION"
    return
  fi
  local tag="v${VERSION}"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    git describe --tags --abbrev=0 "${tag}^" 2>/dev/null | sed 's/^v//' || true
    return
  fi
  local t ver
  for t in $(git -C "$ROOT" tag -l 'v*' --sort=-v:refname 2>/dev/null); do
    ver="${t#v}"
    if [ "$ver" != "$VERSION" ]; then
      echo "$ver"
      return
    fi
  done
}

PREV="$(resolve_prev_version)"
TAG_NEW="v${VERSION}"
TAG_OLD=""
RANGE=""
if [ -n "$PREV" ]; then
  TAG_OLD="v${PREV}"
  if git rev-parse "$TAG_NEW" >/dev/null 2>&1; then
    RANGE="${TAG_OLD}..${TAG_NEW}"
  else
    RANGE="${TAG_OLD}..HEAD"
  fi
fi

{
  echo
  echo "---"
  echo
  echo "## 技术溯源"
  echo
  if [ -n "$RANGE" ] && git rev-parse "$TAG_OLD" >/dev/null 2>&1; then
    echo "完整对比：[${TAG_OLD}...${TAG_NEW}](${REPO_URL}/compare/${TAG_OLD}...${TAG_NEW})"
    echo
    echo "### Commits"
    echo
    git -C "$ROOT" log "$RANGE" --pretty=format:"- [\`%h\`](${REPO_URL}/commit/%H) %s _(%an)_" --no-merges 2>/dev/null || true
    echo
    MERGE_COUNT="$(git -C "$ROOT" log "$RANGE" --merges --oneline 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${MERGE_COUNT:-0}" -gt 0 ]; then
      echo
      echo "### 合并提交"
      echo
      git -C "$ROOT" log "$RANGE" --merges --pretty=format:"- [\`%h\`](${REPO_URL}/commit/%H) %s _(%an)_" 2>/dev/null || true
      echo
    fi
  else
    echo "（无法解析上一版本 tag，略过 commit 列表）"
  fi
} >>"$OUT"

echo "Wrote $OUT"
