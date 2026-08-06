/**
 * 解析音源批量导入文本（支持音源.txt：名称行 + URL 行，或纯 URL 列表）
 */
export type ParsedSource = { name: string; url: string }

const URL_RE = /^https?:\/\/\S+/i
const INLINE_URL_RE = /https?:\/\/\S+/i

function nameFromUrl(url: string) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 2] || parts[parts.length - 1] || u.hostname
  } catch {
    return 'unnamed'
  }
}

/** 清洗名称：去掉包围符号、前后分隔符（如 ： : -） */
export function cleanSourceName(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return 'unnamed'

  // 反复剥掉两侧装饰符（括号、引号、冒号、破折号等）
  for (let i = 0; i < 5; i++) {
    const next = s
      .replace(/^[\s\[【\(（{<"「『《'`“”‘’\-—–_|:：·•.、,，;；]+/u, '')
      .replace(/[\s\]】\)）}>"」』》'`“”‘’\-—–_|:：·•.、,，;；]+$/u, '')
      .trim()
    if (next === s) break
    s = next
  }

  return s || 'unnamed'
}

function extractInline(line: string): { name: string; url: string } | null {
  const m = line.match(INLINE_URL_RE)
  if (!m || m.index == null) return null
  const url = m[0].replace(/[),.;，。；]+$/u, '')
  const before = line.slice(0, m.index).trim()
  if (before) return { name: cleanSourceName(before), url }
  return { name: nameFromUrl(url), url }
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

    // 同行：名称 + URL（含「名称：https://…」）
    if (INLINE_URL_RE.test(line) && !URL_RE.test(line)) {
      const inline = extractInline(line)
      if (inline) {
        result.push(inline)
        pendingName = null
        continue
      }
    }

    if (URL_RE.test(line)) {
      // 可能「https://… 备注」——只取 URL
      const inline = extractInline(line)
      const url = (inline?.url || line.split(/\s+/)[0] || '').replace(/\s+/g, '')
      result.push({
        name: pendingName || nameFromUrl(url),
        url,
      })
      pendingName = null
      continue
    }

    // 非 URL 行视为名称（跳过纯符号）
    if (/^[-—=_*~]{3,}$/.test(line)) continue
    pendingName = cleanSourceName(line)
  }

  // 去重 URL（全量精确匹配），保留首次
  const seen = new Set<string>()
  return result.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

/**
 * 名称冲突时生成「名称 (2)」「名称 (3)」…，taken 为已占用名称集合。
 */
export function allocateUniqueName(baseName: string, taken: Set<string>): string {
  const base = cleanSourceName(baseName || 'unnamed')
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} (${i})`)) i += 1
  return `${base} (${i})`
}
