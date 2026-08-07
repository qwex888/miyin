#!/usr/bin/env bash
# 从 CHANGELOG.md 抽取指定版本的 Release Notes
# 用法: ./scripts/generate-release-notes.sh 0.2.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
OUT="${2:-$ROOT/release_notes.md}"

if [ -z "$VERSION" ]; then
  echo "用法: $0 <version> [out.md]" >&2
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
    echo "详见 [CHANGELOG.md](https://github.com/qwex888/miyin/blob/main/CHANGELOG.md)。"
  } >"$OUT"
fi

echo "Wrote $OUT"
