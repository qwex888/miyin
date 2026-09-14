/** 音源脚本自检发现的可用更新信息 */
export type SourceUpdateInfo = {
  version?: string
  updateUrl?: string
  description?: string
  message?: string
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t || undefined
}

function fromObject(obj: Record<string, unknown>): SourceUpdateInfo | null {
  const version = pickString(obj.version) || pickString(obj.ver) || pickString(obj.newVersion)
  const updateUrl =
    pickString(obj.updateUrl) ||
    pickString(obj.update_url) ||
    pickString(obj.url) ||
    pickString(obj.downloadUrl) ||
    pickString(obj.download_url)
  const description = pickString(obj.description) || pickString(obj.desc)
  const message =
    pickString(obj.log) || pickString(obj.message) || pickString(obj.msg) || pickString(obj.text)

  if (!version && !updateUrl && !description && !message) return null
  // 纯普通错误文案、无版本/链接时不当作「有更新」
  if (!version && !updateUrl && message && !/版本|更新|upgrade|download/i.test(message)) {
    return null
  }
  if (!version && !updateUrl && !/版本|更新|upgrade|download/i.test(description || message || '')) {
    return null
  }

  return {
    version,
    updateUrl,
    description,
    message,
  }
}

/** 从 updateAlert / console 参数中提取结构化更新信息 */
export function parseSourceUpdateHint(input: unknown): SourceUpdateInfo | null {
  if (input == null) return null

  if (typeof input === 'object' && !Array.isArray(input)) {
    return fromObject(input as Record<string, unknown>)
  }

  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text) return null

  // inspect / JSON 混排：... { version: '1.3.0', updateUrl: 'https://...' }
  const urlMatch = text.match(/https?:\/\/[^\s"'`<>]+/i)
  const versionMatch = text.match(/\bv\s*(\d+\.\d+(?:\.\d+)?)\b/i) || text.match(/version['":\s]+['"]?(\d+\.\d+(?:\.\d+)?)/i)
  const updateUrlMatch =
    text.match(/updateUrl['":\s]+['"]?(https?:\/\/[^'"\s,}]+)/i) ||
    text.match(/update_url['":\s]+['"]?(https?:\/\/[^'"\s,}]+)/i)

  const updateUrl = updateUrlMatch?.[1] || ( /更新|版本|upgrade/i.test(text) ? urlMatch?.[0]?.replace(/[),.;]+$/, '') : undefined)
  const version = versionMatch?.[1]
  const looksUpdate = /发现新版本|需要更新|请.*更新|版本过[低旧]|download.*latest|upgrade/i.test(text)

  if (!looksUpdate && !updateUrlMatch && !version) return null

  return {
    version,
    updateUrl,
    message: text.slice(0, 300),
  }
}

export function mergeSourceUpdateInfo(
  ...parts: Array<SourceUpdateInfo | null | undefined>
): SourceUpdateInfo | null {
  let out: SourceUpdateInfo | null = null
  for (const p of parts) {
    if (!p) continue
    out = {
      version: p.version || out?.version,
      updateUrl: p.updateUrl || out?.updateUrl,
      description: p.description || out?.description,
      message: p.message || out?.message,
    }
  }
  return out
}

/** 是否可直接下载覆盖的脚本 URL（排除文档站） */
export function isDirectSourceScriptUrl(url: string): boolean {
  const raw = String(url || '').trim()
  if (!/^https?:\/\/.+/i.test(raw)) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  if (/yuque\.com$|notion\.(so|site)$|docs\.google\.com$|jianyu\.com$|feishu\.cn$|gitbook\.io$/i.test(host)) {
    return false
  }
  if (/\.js$/i.test(u.pathname)) return true
  if (/raw\.githubusercontent\.com$|gist\.githubusercontent\.com$|cdn\.jsdelivr\.net$/i.test(host)) {
    return true
  }
  return false
}

export function sourceUpdateCanOneClick(info: SourceUpdateInfo | null | undefined): boolean {
  return Boolean(info?.updateUrl && isDirectSourceScriptUrl(info.updateUrl))
}
