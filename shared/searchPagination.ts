/** 各平台搜索单页条数（与 platformSearch / platformAlbum 上游 limit 对齐） */
export const SEARCH_PAGE_SIZE = 30

/**
 * 是否还有下一页：仅当本页「满页」才继续加载。
 * 空页 / 不满一页 → false，避免触底后空转或无限请求。
 */
export function searchPageHasMore(pageItemCount: number, pageSize = SEARCH_PAGE_SIZE): boolean {
  return pageItemCount >= pageSize
}

/** 关键词分词：按空白与常见标点切开，丢弃单字（单字查询噪声太大，直接放行不参与判定） */
export function searchKeywordTokens(keyword: string): string[] {
  return String(keyword || '')
    .toLowerCase()
    .split(/[\s,，、;；|/\\+]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
}

type KeywordMatchable = {
  title?: string
  artist?: string
  album?: string
}

/**
 * 条目是否与关键词沾边。
 *
 * 判定分两档（实测校准，见 `reports/2026-10-26-tx-search-tail-pollution.md`）：
 * - **标题 / 歌手**：命中任一 token 即可（歌名与歌手常分开写，如「周杰伦」+「晴天」）；
 * - **专辑名**：必须包含**全部** token —— 否则「凡人修仙传 电视剧原声专辑」会把整张 OST 都放进来，
 *   而用户搜的是「凡人修仙传 大灰狼」这个演播版本。
 */
export function trackMatchesKeyword(track: KeywordMatchable, tokens: string[]): boolean {
  if (!tokens.length) return true
  const title = String(track.title || '').toLowerCase()
  const artist = String(track.artist || '').toLowerCase()
  const album = String(track.album || '').toLowerCase()
  if (tokens.some((token) => title.includes(token) || artist.includes(token))) return true
  return tokens.every((token) => album.includes(token))
}

/**
 * 「上游兜底页」检测。
 *
 * QQ 搜索在歌曲索引耗尽后**不会返回空页**，而是用同 IP 的相关推荐（OST、翻唱、同歌手其他歌）
 * 把整页凑满 —— 实测某有声书查询在第 991 条之后开始混入原声带曲目，直到第 1214 条才真正返回空。
 * 命中率低于阈值即判定为兜底页：停止翻页并丢弃该页噪声，避免把推荐结果当成搜索结果。
 *
 * ⚠️ 只在 `page >= 2` 时使用：首页是上游最相关的结果，误判代价最大。
 */
export function isFallbackSearchPage(
  items: KeywordMatchable[],
  tokens: string[],
  threshold = 0.3,
): boolean {
  if (!tokens.length || items.length < SEARCH_PAGE_SIZE) return false
  const hit = items.filter((item) => trackMatchesKeyword(item, tokens)).length
  return hit / items.length < threshold
}
