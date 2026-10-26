import { searchPlatform, listSearchablePlatforms } from '~~/server/services/platformSearch'
import { searchAlbums, listAlbumCapablePlatforms } from '~~/server/services/platformAlbum'
import { platformLabel } from '#shared/platforms'
import {
  SEARCH_PAGE_SIZE,
  isFallbackSearchPage,
  searchKeywordTokens,
  searchPageHasMore,
  trackMatchesKeyword,
} from '#shared/searchPagination'
import { listEnabledOkSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    platform?: string
    keyword?: string
    page?: number
    type?: 'song' | 'album'
  }>(event)
  const platform = body?.platform || 'wy'
  const keyword = body?.keyword || ''
  const page = body?.page || 1
  const type = body?.type === 'album' ? 'album' : 'song'

  const albumCapable = listAlbumCapablePlatforms()
  const searchable = listSearchablePlatforms()
  const platforms = searchable.map((p) => ({
    id: p,
    label: platformLabel(p),
    sourceCount: listEnabledOkSources(p).length,
    albumCapable: albumCapable.includes(p as (typeof albumCapable)[number]),
  }))

  if (type === 'album') {
    const items = await searchAlbums(platform, keyword, page)
    const sources = listEnabledOkSources(platform)
    return {
      type,
      platform,
      platforms,
      sourceHint: sources.map((s) => s.name),
      items,
      hasMore: searchPageHasMore(items.length),
      filtered: 0,
    }
  }

  const raw = await searchPlatform(platform, keyword, page)
  const sources = listEnabledOkSources(platform)

  /**
   * 上游兜底结果过滤（Issue #40 续）。
   *
   * QQ 搜索在索引耗尽后不返回空页，而是把「同 IP 相关推荐」（OST / 同歌手其他歌）凑满一页，
   * 于是无限翻页会把 OST 当成搜索结果追加进来。这里的处理：
   * - `page >= 2` 才过滤（首页是上游最相关结果，误判代价最大）；
   * - 本页命中率低于阈值 → 判定为兜底页，**停止翻页**并只保留真正匹配关键词的条目。
   */
  const tokens = searchKeywordTokens(keyword)
  const guardEnabled = page >= 2 && tokens.length > 0
  const fallback = guardEnabled && isFallbackSearchPage(raw, tokens)
  const items = guardEnabled ? raw.filter((t) => trackMatchesKeyword(t, tokens)) : raw
  const hasMore = fallback ? false : searchPageHasMore(raw.length, SEARCH_PAGE_SIZE)

  return {
    type,
    platform,
    platforms,
    sourceHint: sources.map((s) => s.name),
    items,
    hasMore,
    /** 被判定为「上游兜底推荐」而丢弃的条数（>0 时前端提示「已过滤」） */
    filtered: raw.length - items.length,
  }
})
