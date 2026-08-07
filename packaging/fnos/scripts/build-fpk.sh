#!/usr/bin/env bash
# 构建觅音 Native .fpk（需本机安装 fnpack）
# - 统一网关 /app/miyin
# - D2 胖包：better-sqlite3 自带 prebuilds（linux-x64 / linux-arm64）
# 参考：https://developer.fnnas.com/docs/examples/native/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK_DIR="$ROOT/packaging/fnos/miyin"
SERVER_DIR="$PACK_DIR/app/server"
ENTRY_SRC="$ROOT/packaging/fnos/server-entry.mjs"
BSQL_VER="13.0.3"

cd "$ROOT"

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build with gateway baseURL"
NUXT_APP_BASE_URL=/app/miyin/ GATEWAY_PREFIX=/app/miyin/ pnpm build

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
  corepack enable >/dev/null 2>&1 || true
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prod
  else
    npm install --omit=dev
  fi
)

# better-sqlite3@13+ 在 npm 包内自带各平台 prebuilds；校验 x86/arm 均在
PREBUILD_DIR=""
for cand in \
  "$SERVER_DIR/node_modules/better-sqlite3/prebuilds" \
  "$SERVER_DIR/node_modules/.pnpm"/better-sqlite3@*/node_modules/better-sqlite3/prebuilds
do
  if [ -d "$cand" ]; then
    PREBUILD_DIR="$cand"
    break
  fi
done

if [ -z "$PREBUILD_DIR" ]; then
  echo "ERROR: 未找到 better-sqlite3/prebuilds"
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
if ! command -v fnpack >/dev/null 2>&1; then
  echo "WARN: fnpack 未安装。应用文件已就绪：$PACK_DIR"
  echo "请在飞牛开发环境执行：cd packaging/fnos/miyin && fnpack build"
  exit 0
fi

(
  cd "$PACK_DIR"
  fnpack build
)

echo "==> done"
find "$ROOT" "$PACK_DIR" -maxdepth 2 -name 'miyin.fpk' 2>/dev/null || true
