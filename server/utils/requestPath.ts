/**
 * 请求路径的归一化：始终返回「相对应用根」的路径（如 `/api/downloads`）。
 *
 * 为什么需要它 —— `getRequestURL(event).pathname` 在本项目不可用于路径判定：
 * h3 的 `getRequestURL` 优先读 `req.originalUrl`（完整原始 URL），而 Nitro 挂载
 * `app.baseURL` 时只重写 `event._path` 与 `req.url`，**不动 `originalUrl`**。
 * 飞牛网关下 baseURL 是 `/app/miyin/`，于是 pathname 是 `/app/miyin/api/xxx`，
 * `startsWith('/api/')` 判定为 false → 鉴权中间件直接放行 → 全部接口免鉴权。
 *
 * `event.path` 已被 h3 剥掉挂载前缀；只有适配器没写 `_path` 时才回退到
 * 「原始路径 − baseURL」手工剥离一次。
 */
type RequestPathEvent = {
  path?: string
  node?: { req?: { originalUrl?: string; url?: string } }
}

/** 与 nuxt.config 的 `app.baseURL` 同源：NUXT_APP_BASE_URL / GATEWAY_PREFIX，末尾带 `/` */
export function getAppBaseURL(): string {
  const raw = process.env.NUXT_APP_BASE_URL || process.env.GATEWAY_PREFIX || '/'
  return raw.endsWith('/') ? raw : `${raw}/`
}

export function relativeRequestPath(event: RequestPathEvent): string {
  const stripped = event?.path
  if (stripped) return stripped

  const raw = event?.node?.req?.originalUrl || event?.node?.req?.url || '/'
  const base = getAppBaseURL()
  if (base !== '/' && raw.startsWith(base)) {
    return `/${raw.slice(base.length)}`
  }
  return raw
}
