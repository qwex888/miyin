#!/usr/bin/env bash
# 构建觅音 Native .fpk（fnpack 缺失时自动下载到 tools/fnpack，可用 FNPACK_BIN 指定）
# - 统一网关 /app/miyin
# - D2 胖包：better-sqlite3 自带 prebuilds（linux-x64 / linux-arm64）
# 环境变量：
#   MIYIN_VERSION   覆盖 manifest.version（如 0.2.0）
#   REQUIRE_FNPACK  设为 1 时缺少 fnpack 且自动下载失败则报错（CI 用）
#   FNPACK_BIN      指定 fnpack 二进制路径（默认依次找 PATH、tools/fnpack）
#   FNPACK_VERSION  自动下载的 fnpack 版本（默认 1.2.3，见 scripts/download-fnpack.mjs）
#   FPK_OUT         额外输出 .fpk 路径（dist/miyin-v<version>.fpk 总会生成）
# 参考：https://developer.fnnas.com/docs/examples/native/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK_DIR="$ROOT/packaging/fnos/miyin"
SERVER_DIR="$PACK_DIR/app/server"
ENTRY_SRC="$ROOT/packaging/fnos/server-entry.mjs"
BSQL_VER="13.0.3"
REQUIRE_FNPACK="${REQUIRE_FNPACK:-0}"

cd "$ROOT"

if [ -n "${MIYIN_VERSION:-}" ]; then
  echo "==> set manifest version=${MIYIN_VERSION}"
  export MIYIN_VERSION
  sed -i.bak -E "s/^version=.*/version=${MIYIN_VERSION}/" "$PACK_DIR/manifest"
  rm -f "$PACK_DIR/manifest.bak"
  if [ -f "$ROOT/package.json" ] && grep -q '"version"' "$ROOT/package.json"; then
    node -e "
      const fs=require('fs');
      const p=process.argv[1];
      const ver=process.env.MIYIN_VERSION;
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      j.version=ver;
      fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
    " "$ROOT/package.json"
  fi
fi

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build with gateway baseURL"
MSYS_NO_PATHCONV=1 NUXT_APP_BASE_URL=/app/miyin/ GATEWAY_PREFIX=/app/miyin/ pnpm build

echo "==> stage server payload"
rm -rf "$SERVER_DIR"
mkdir -p "$SERVER_DIR"
cp -R "$ROOT/.output" "$SERVER_DIR/.output"
cp "$ENTRY_SRC" "$SERVER_DIR/start.mjs"

cat > "$SERVER_DIR/package.json" <<EOF
{
  "name": "miyin-fnos-server",
  "private": true,
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^${BSQL_VER}"
  }
}
EOF

(
  cd "$SERVER_DIR"
  # 必须与仓库根 pnpm workspace 隔离，否则会装到 ../../../../.. 而本目录无 node_modules
  if command -v npm >/dev/null 2>&1; then
    npm install --omit=dev --no-package-lock --no-fund --no-audit
  else
    corepack enable >/dev/null 2>&1 || true
    pnpm install --prod --ignore-workspace
  fi
)

# better-sqlite3@13+ 在 npm 包内自带各平台 prebuilds；校验 x86/arm 均在
find_prebuild_dir() {
  local base="$1"
  local cand
  for cand in \
    "$base/node_modules/better-sqlite3/prebuilds" \
    "$base/node_modules/.pnpm"/better-sqlite3@*/node_modules/better-sqlite3/prebuilds
  do
    # 通配可能不存在；逐个探测
    if [ -d "$cand" ]; then
      printf '%s' "$cand"
      return 0
    fi
  done
  # find 兜底（npm / pnpm 嵌套）
  cand="$(find "$base/node_modules" -type d -path '*/better-sqlite3/prebuilds' 2>/dev/null | head -n 1 || true)"
  if [ -n "$cand" ] && [ -d "$cand" ]; then
    printf '%s' "$cand"
    return 0
  fi
  return 1
}

PREBUILD_DIR=""
if PREBUILD_DIR="$(find_prebuild_dir "$SERVER_DIR")"; then
  :
elif PREBUILD_DIR="$(find_prebuild_dir "$ROOT")"; then
  echo "==> 从仓库根复制 better-sqlite3 到 FPK server（含 prebuilds）"
  mkdir -p "$SERVER_DIR/node_modules"
  # 解析实际包路径
  SRC_PKG="$(dirname "$PREBUILD_DIR")"
  rm -rf "$SERVER_DIR/node_modules/better-sqlite3"
  cp -R "$SRC_PKG" "$SERVER_DIR/node_modules/better-sqlite3"
  PREBUILD_DIR="$SERVER_DIR/node_modules/better-sqlite3/prebuilds"
else
  echo "ERROR: 未找到 better-sqlite3/prebuilds"
  echo "--- debug: SERVER_DIR ---"
  ls -la "$SERVER_DIR" || true
  ls -la "$SERVER_DIR/node_modules" 2>/dev/null || echo "(no node_modules)"
  find "$SERVER_DIR/node_modules" -iname '*better-sqlite3*' 2>/dev/null | head -40 || true
  echo "--- debug: ROOT ---"
  find "$ROOT/node_modules" -type d -path '*/better-sqlite3/prebuilds' 2>/dev/null | head -10 || true
  exit 1
fi

echo "==> sqlite prebuilds at $PREBUILD_DIR"
ls -lah "$PREBUILD_DIR"
for need in linux-x64.node linux-arm64.node; do
  if [ ! -f "$PREBUILD_DIR/$need" ]; then
    echo "ERROR: 缺少 $need（双架构胖包需要）"
    exit 1
  fi
done

chmod +x "$PACK_DIR/cmd/"* "$SERVER_DIR/start.mjs"

echo "==> verify fnpack required files"
required=(
  manifest
  ICON.PNG
  ICON_256.PNG
  cmd/main
  cmd/install_init
  cmd/install_callback
  cmd/uninstall_init
  cmd/uninstall_callback
  cmd/upgrade_init
  cmd/upgrade_callback
  cmd/config_init
  cmd/config_callback
  cmd/lib_config.sh
  config/privilege
  config/resource
  app/ui/config
  app/server/start.mjs
  wizard/install
  wizard/config
  wizard/uninstall
)
missing=0
for rel in "${required[@]}"; do
  if [ ! -e "$PACK_DIR/$rel" ]; then
    echo "MISSING: $rel"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "ERROR: 应用包缺少必需文件，已中止打包"
  exit 1
fi

echo "==> fnpack build"
# fnpack 查找顺序：FNPACK_BIN > PATH > tools/fnpack(.exe)（参考 fnos-app-shutdown 流程）
resolve_tools_fnpack() {
  if [ -x "$ROOT/tools/fnpack" ]; then
    echo "$ROOT/tools/fnpack"
  elif [ -x "$ROOT/tools/fnpack.exe" ]; then
    echo "$ROOT/tools/fnpack.exe"
  fi
}

FNPACK_RESOLVED=""
if [ -n "${FNPACK_BIN:-}" ] && [ -x "${FNPACK_BIN}" ]; then
  FNPACK_RESOLVED="${FNPACK_BIN}"
elif command -v fnpack >/dev/null 2>&1; then
  FNPACK_RESOLVED="$(command -v fnpack)"
else
  FNPACK_RESOLVED="$(resolve_tools_fnpack)"
fi

if [ -z "$FNPACK_RESOLVED" ]; then
  echo "==> fnpack 未安装，尝试自动下载到 tools/fnpack"
  if node "$ROOT/scripts/download-fnpack.mjs"; then
    FNPACK_RESOLVED="$(resolve_tools_fnpack)"
  fi
fi

if [ -z "$FNPACK_RESOLVED" ]; then
  if [ "$REQUIRE_FNPACK" = "1" ]; then
    echo "ERROR: 未安装 fnpack 且自动下载失败（REQUIRE_FNPACK=1）"
    exit 1
  fi
  echo "WARN: fnpack 未安装。应用文件已就绪：$PACK_DIR"
  echo "可执行 pnpm download:fnpack 后重试，或在飞牛开发环境执行：cd packaging/fnos/miyin && fnpack build"
  exit 0
fi

(
  cd "$PACK_DIR"
  "$FNPACK_RESOLVED" build
)

FPK_SRC="$(find "$PACK_DIR" "$ROOT" -maxdepth 2 -name 'miyin.fpk' -type f 2>/dev/null | head -n 1 || true)"
if [ -z "$FPK_SRC" ]; then
  echo "ERROR: 未找到 miyin.fpk"
  exit 1
fi

if [ -n "${FPK_OUT:-}" ]; then
  mkdir -p "$(dirname "$FPK_OUT")"
  cp -f "$FPK_SRC" "$FPK_OUT"
  echo "==> copied to $FPK_OUT"
fi

# 同步一份带版本号的产物到 dist/（参考 fnos-app-shutdown 流程，便于上传到开发设备）
MANIFEST_VERSION="$(sed -n 's/^version=//p' "$PACK_DIR/manifest" | head -n 1)"
if [ -n "$MANIFEST_VERSION" ]; then
  mkdir -p "$ROOT/dist"
  cp -f "$FPK_SRC" "$ROOT/dist/miyin-v${MANIFEST_VERSION}.fpk"
  echo "==> dist: $ROOT/dist/miyin-v${MANIFEST_VERSION}.fpk"
fi

echo "==> done: $FPK_SRC"
ls -lah "$FPK_SRC"
