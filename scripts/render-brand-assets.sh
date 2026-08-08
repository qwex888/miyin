#!/usr/bin/env bash
# 从 outputs/miyin-logo 概念二浅色标重新导出公共 / 飞牛图标资源
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_LIGHT="$ROOT/outputs/miyin-logo/assets/concept-2-m-light.svg"
SRC_DARK="$ROOT/outputs/miyin-logo/assets/concept-2-m-dark.svg"

if [ ! -f "$SRC_LIGHT" ]; then
  echo "missing $SRC_LIGHT"
  exit 1
fi

mkdir -p "$ROOT/public" "$ROOT/app/assets/brand" "$ROOT/packaging/fnos/miyin/app/ui/images"
cp "$SRC_LIGHT" "$ROOT/public/logo.svg"
cp "$SRC_DARK" "$ROOT/public/logo-dark.svg"
cp "$SRC_LIGHT" "$ROOT/public/favicon.svg"
cp "$SRC_LIGHT" "$ROOT/app/assets/brand/logo.svg"
cp "$SRC_DARK" "$ROOT/app/assets/brand/logo-dark.svg"

render() {
  local size=$1 out=$2 bg=${3:-}
  local args=(--fit-width "$size" --fit-height "$size")
  if [ -n "$bg" ]; then args+=(--background "$bg"); fi
  npx --yes @resvg/resvg-js-cli "${args[@]}" "$SRC_LIGHT" "$out"
  echo "-> $out"
}

# 飞牛桌面/应用图标需不透明白底（与 ICON*.PNG 一致）
render 64  "$ROOT/packaging/fnos/miyin/app/ui/images/icon_64.png" "white"
render 128 "$ROOT/packaging/fnos/miyin/app/ui/images/icon_128.png" "white"
render 256 "$ROOT/packaging/fnos/miyin/app/ui/images/icon_256.png" "white"
render 64  "$ROOT/packaging/fnos/miyin/ICON.PNG" "white"
render 256 "$ROOT/packaging/fnos/miyin/ICON_256.PNG" "white"
render 192 "$ROOT/public/logo-192.png"
render 512 "$ROOT/public/logo-512.png"

echo "done"
