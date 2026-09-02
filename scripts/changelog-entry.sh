#!/usr/bin/env bash
# 向 CHANGELOG [Unreleased] 追加一条用户可感知摘要（不含 commit SHA）
# 用法:
#   bash scripts/changelog-entry.sh Fixed "修复下载取消竞态"
#   bash scripts/changelog-entry.sh Added "队列 Tab 分页" --author wht300 --pr 10
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/CHANGELOG.md"

TYPE="${1:-}"
MSG="${2:-}"
AUTHOR=""
PR=""

shift 2 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --author) AUTHOR="${2:-}"; shift 2 ;;
    --pr) PR="${2:-}"; shift 2 ;;
    *)
      echo "未知参数: $1" >&2
      echo "用法: changelog-entry.sh <Added|Changed|Fixed|Removed> \"描述\" [--author 用户名] [--pr 编号]" >&2
      exit 1
      ;;
  esac
done

if [ -z "$TYPE" ] || [ -z "$MSG" ]; then
  echo "用法: changelog-entry.sh <Added|Changed|Fixed|Removed> \"描述\" [--author 用户名] [--pr 编号]" >&2
  exit 1
fi

case "$TYPE" in
  Added|Changed|Fixed|Removed) ;;
  *)
    echo "类型须为 Added / Changed / Fixed / Removed" >&2
    exit 1
    ;;
esac

if [ -z "$AUTHOR" ]; then
  AUTHOR="$(gh api user -q .login 2>/dev/null || git config user.name 2>/dev/null || true)"
fi

SUFFIX=""
if [ -n "$AUTHOR" ] && [ -n "$PR" ]; then
  SUFFIX=" (@${AUTHOR}, PR #${PR})"
elif [ -n "$AUTHOR" ]; then
  SUFFIX=" (@${AUTHOR})"
elif [ -n "$PR" ]; then
  SUFFIX=" (PR #${PR})"
fi

LINE="- ${MSG}${SUFFIX}"

python3 - "$FILE" "$TYPE" "$LINE" <<'PY'
import re, sys
from pathlib import Path

path, typ, line = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text(encoding="utf-8")
m = re.search(r"(## \[Unreleased\]\n)(.*?)(\n## \[|\Z)", text, re.S)
if not m:
    sys.exit("CHANGELOG 缺少 ## [Unreleased] 段")

body = m.group(2)
header = f"### {typ}"
if header not in body:
    body = body.rstrip() + f"\n\n{header}\n"

idx = body.find(header) + len(header)
# 插入到该 ### 小节首个 bullet 之前（标题后）
rest = body[idx:].lstrip("\n")
body = body[:idx] + "\n\n" + line + "\n" + (("\n" + rest) if rest else "")

new_body = body.strip() + "\n"
text = text[: m.start(2)] + new_body + text[m.end(2) :]
path.write_text(text, encoding="utf-8")
print(f"✓ 已追加到 [Unreleased] / {typ}:")
print(f"  {line}")
PY
