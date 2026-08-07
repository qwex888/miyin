#!/usr/bin/env bash
# 一键发版：升版本 → 更新 CHANGELOG/manifest → 本地检测 → 提交 → 打 tag → 推送
# 推送 tag 后由 GitHub Actions「Build & Release」构建多架构 Docker、FPK 胖包并写入 Releases。
# 用法:
#   pnpm release              # 交互选择 patch/minor/major
#   pnpm release -- patch     # 非交互
#   pnpm release -- 0.3.0     # 指定版本
#   SKIP_CHECKS=1 pnpm release -- patch
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

REPO_URL="https://github.com/qwex888/miyin"
SKIP_CHECKS="${SKIP_CHECKS:-0}"
ARG="${1:-}"

if [ -n "$(git status --porcelain)" ]; then
  error "工作区有未提交的更改，请先提交或暂存"
fi

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
  warn "当前分支: $BRANCH (不是 main/master)"
  if [ -z "$ARG" ]; then
    read -rp "是否继续? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
  else
    error "非交互模式请在 main 分支发版"
  fi
fi

CURRENT=$(node -p "require('./package.json').version")
info "当前版本: v${CURRENT}"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

if [ -n "$ARG" ]; then
  case "$ARG" in
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    *)
      NEW_VERSION="${ARG#v}"
      [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]] || error "无效版本号: $ARG"
      ;;
  esac
else
  echo ""
  echo "选择版本类型:"
  echo "  1) patch  → v${MAJOR}.${MINOR}.$((PATCH + 1))"
  echo "  2) minor  → v${MAJOR}.$((MINOR + 1)).0"
  echo "  3) major  → v$((MAJOR + 1)).0.0"
  echo "  4) 自定义"
  echo ""
  read -rp "请选择 [1-4] (默认 1): " choice
  choice=${choice:-1}
  case $choice in
    1) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    2) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    3) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    4)
      read -rp "输入版本号 (不带 v 前缀): " NEW_VERSION
      [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]] || error "无效的版本号格式"
      ;;
    *) error "无效选择" ;;
  esac
fi

TAG="v${NEW_VERSION}"

if git rev-parse "$TAG" &>/dev/null; then
  error "Tag ${TAG} 已存在"
fi

info "新版本: ${TAG}"
if [ -z "$ARG" ]; then
  echo ""
  read -rp "确认发布 ${TAG}? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { warn "已取消"; exit 0; }
fi

# package.json
node -e "
  const fs=require('fs');
  const p='package.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.version=process.argv[1];
  fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
" "$NEW_VERSION"
info "已更新 package.json → ${NEW_VERSION}"

# 飞牛 manifest
MANIFEST="packaging/fnos/miyin/manifest"
if [ -f "$MANIFEST" ]; then
  sed -i.bak -E "s/^version=.*/version=${NEW_VERSION}/" "$MANIFEST"
  rm -f "${MANIFEST}.bak"
  info "已更新 ${MANIFEST} → ${NEW_VERSION}"
fi

# CHANGELOG: Unreleased → 新版本段
TODAY=$(date +%Y-%m-%d)
python3 - "$NEW_VERSION" "$CURRENT" "$TODAY" <<'PY'
import re, sys
from pathlib import Path

new_ver, prev_ver, today = sys.argv[1], sys.argv[2], sys.argv[3]
path = Path("CHANGELOG.md")
text = path.read_text(encoding="utf-8")

m = re.search(r"(## \[Unreleased\]\n)(.*?)(\n## \[)", text, re.S)
if not m:
    print("CHANGELOG 缺少 [Unreleased] 段", file=sys.stderr)
    sys.exit(1)

body = m.group(2).strip()
if not body:
    body = "### Changed\n\n- 维护版本发布"

# 若目标版本段已存在则只清空 Unreleased，不重复插入
ver_header = f"## [{new_ver}]"
if ver_header in text:
    text = text[: m.start()] + m.group(1) + "\n" + m.group(3) + text[m.end() :]
else:
    inserted = f"{m.group(1)}\n{ver_header} - {today}\n\n{body}\n{m.group(3)}"
    text = text[: m.start()] + inserted + text[m.end() :]

# 重建尾部链接
hist = []
for line in text.splitlines():
    mm = re.match(r"^\[(\d+\.\d+\.\d+[^\]]*)\]: (https://.+)$", line)
    if not mm:
        continue
    ver = mm.group(1)
    if ver == new_ver:
        continue
    hist.append((ver, line))

text_body = re.sub(r"\n\[Unreleased\]:[\s\S]*\Z", "\n", text).rstrip() + "\n"
# 也去掉可能残留的仅版本链接尾
text_body = re.sub(
    r"\n(?:\[\d[^\n]*\]: https://github\.com/qwex888/miyin[^\n]*\n)+\Z",
    "\n",
    text_body,
).rstrip() + "\n\n"

links = [
    f"[Unreleased]: https://github.com/qwex888/miyin/compare/v{new_ver}...HEAD",
    f"[{new_ver}]: https://github.com/qwex888/miyin/compare/v{prev_ver}...v{new_ver}",
]
seen = {new_ver}
for ver, line in hist:
    if ver in seen:
        continue
    seen.add(ver)
    links.append(line)

path.write_text(text_body + "\n".join(links) + "\n", encoding="utf-8")
print(f"CHANGELOG → [{new_ver}]")
PY

chmod +x scripts/generate-release-notes.sh
./scripts/generate-release-notes.sh "$NEW_VERSION" release_notes.md
info "已生成 release_notes.md"

if [ "$SKIP_CHECKS" != "1" ]; then
  info "运行本地检测 (pnpm test && pnpm build)…"
  corepack enable >/dev/null 2>&1 || true
  pnpm test
  pnpm build
  info "本地检测通过"
else
  warn "已跳过本地检测 (SKIP_CHECKS=1)"
fi

git add package.json packaging/fnos/miyin/manifest CHANGELOG.md release_notes.md
git commit -m "release: ${TAG}"
info "已提交 release: ${TAG}"

git tag -a "$TAG" -m "Release ${TAG}"
info "已创建 tag: ${TAG}"

git push origin "$BRANCH"
git push origin "$TAG"
info "已推送到远程"

echo ""
echo -e "${GREEN}🎉 发布已触发!${NC}"
echo "   版本: ${TAG}"
echo "   Actions: ${REPO_URL}/actions"
echo "   Releases: ${REPO_URL}/releases"
echo ""
echo "   CI 将依次：test-and-build → Docker 多架构推送 → FPK 胖包 → 创建 GitHub Release（含 miyin-${TAG}.fpk）"
echo "   请勿在本地执行 gh release create；若失败可在 Actions 重跑「Build & Release」并输入 tag: ${TAG}"
