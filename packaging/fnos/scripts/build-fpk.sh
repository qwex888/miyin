#!/usr/bin/env bash
# 构建觅音 Native .fpk（需本机安装 fnpack）
# 参考：https://developer.fnnas.com/docs/examples/native/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK_DIR="$ROOT/packaging/fnos/miyin"
SERVER_DIR="$PACK_DIR/app/server"
ENTRY_SRC="$ROOT/packaging/fnos/server-entry.mjs"

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

# better-sqlite3 为 nitro external，单独安装运行时依赖（请在目标架构上构建）
cat > "$SERVER_DIR/package.json" <<'EOF'
{
  "name": "miyin-fnos-server",
  "private": true,
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^13.0.3"
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

chmod +x "$PACK_DIR/cmd/main" "$SERVER_DIR/start.mjs"

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
