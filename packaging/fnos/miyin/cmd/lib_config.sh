#!/bin/bash
# 共享：读写 $TRIM_PKGETC/miyin.env（供 install/config 回调与 main 使用）

MIYIN_CFG_FILE="${TRIM_PKGETC}/miyin.env"

miyin_shell_escape() {
  # 单引号包裹，内部 ' → '\''
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

miyin_read_cfg_value() {
  local key="$1"
  local file="${2:-$MIYIN_CFG_FILE}"
  [ -f "$file" ] || return 0
  # shellcheck disable=SC1090
  (
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
    eval "printf '%s' \"\${$key:-}\""
  )
}

miyin_gen_session_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# 根据向导变量写入配置。保留已有 SESSION_SECRET。
# AUTH_TOKEN 允许为空：空 = 开放模式（免登录）。
miyin_write_config_from_wizard() {
  local token="${wizard_auth_token-}"
  local mode="${wizard_download_mode:-default}"
  local custom_dir="${wizard_download_dir:-}"
  local secret=""

  if [ -n "$token" ] && [ "${#token}" -lt 6 ]; then
    echo "访问口令至少 6 位，或留空以关闭鉴权" >"${TRIM_TEMP_LOGFILE:-/dev/stderr}"
    return 1
  fi

  # 用户填了绝对路径但未切换 radio 到 custom 时，自动按自定义处理（常见误操作）
  if [ -n "$custom_dir" ] && [[ "$custom_dir" == /* ]]; then
    mode="custom"
  fi

  if [ "$mode" = "custom" ]; then
    if [ -z "$custom_dir" ] || [[ "$custom_dir" != /* ]]; then
      echo "自定义下载目录必须是以 / 开头的绝对路径；请选择「自定义」并填写路径" >"${TRIM_TEMP_LOGFILE:-/dev/stderr}"
      return 1
    fi
  else
    mode="default"
    custom_dir=""
  fi

  mkdir -p "${TRIM_PKGETC}"
  secret="$(miyin_read_cfg_value SESSION_SECRET)"
  if [ -z "$secret" ]; then
    secret="$(miyin_gen_session_secret)"
  fi

  umask 077
  cat >"$MIYIN_CFG_FILE" <<EOF
# 觅音运行配置（由安装/配置向导生成，请勿手改敏感字段到日志）
# AUTH_TOKEN 为空表示开放模式（免登录）
AUTH_TOKEN='$(miyin_shell_escape "$token")'
SESSION_SECRET='$(miyin_shell_escape "$secret")'
DOWNLOAD_MODE='$(miyin_shell_escape "$mode")'
CUSTOM_DOWNLOAD_DIR='$(miyin_shell_escape "$custom_dir")'
EOF
  chmod 600 "$MIYIN_CFG_FILE" 2>/dev/null || true
  return 0
}

miyin_load_config() {
  if [ -f "$MIYIN_CFG_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$MIYIN_CFG_FILE"
    set +a
  fi
}
