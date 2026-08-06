/**
 * 解析音源批量导入文本（支持音源.txt：名称行 + URL 行，或纯 URL 列表）
 */
export type ParsedSource = { name: string; url: string }

const URL_RE = /^https?:\/\/\S+/i

function nameFromUrl(url: string) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 2] || parts[parts.length - 1] || u.hostname
  } catch {
    return 'unnamed'
  }
}

export function parseSourceText(text: string): ParsedSource[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const skipHints = ['更多资源', '洛雪音乐', '在线导入', '内容来源于', '微信公众号', '不能使用了']
  const result: ParsedSource[] = []
  let pendingName: string | null = null

  for (const line of lines) {
    if (skipHints.some((h) => line.includes(h))) continue
    if (URL_RE.test(line)) {
      const url = line.replace(/\s+/g, '')
      result.push({
        name: pendingName || nameFromUrl(url),
        url,
      })
      pendingName = null
      continue
    }
    // 非 URL 行视为名称（跳过纯符号）
    if (/^[-—=]{3,}$/.test(line)) continue
    pendingName = line
  }

  // 去重 URL，保留首次
  const seen = new Set<string>()
  return result.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}
