import { describe, expect, it } from 'vitest'
import {
  SEARCH_PAGE_SIZE,
  isFallbackSearchPage,
  searchKeywordTokens,
  searchPageHasMore,
  trackMatchesKeyword,
} from '../shared/searchPagination'

describe('searchPageHasMore', () => {
  it('满页才继续', () => {
    expect(searchPageHasMore(SEARCH_PAGE_SIZE)).toBe(true)
    expect(searchPageHasMore(SEARCH_PAGE_SIZE + 1)).toBe(true)
  })

  it('空页 / 不满一页停止', () => {
    expect(searchPageHasMore(0)).toBe(false)
    expect(searchPageHasMore(1)).toBe(false)
    expect(searchPageHasMore(SEARCH_PAGE_SIZE - 1)).toBe(false)
  })

  it('支持自定义 pageSize', () => {
    expect(searchPageHasMore(10, 10)).toBe(true)
    expect(searchPageHasMore(9, 10)).toBe(false)
  })
})

describe('searchKeywordTokens', () => {
  it('按空白与标点切分，丢单字', () => {
    expect(searchKeywordTokens('凡人修仙传 大灰狼')).toEqual(['凡人修仙传', '大灰狼'])
    expect(searchKeywordTokens('周杰伦，晴天')).toEqual(['周杰伦', '晴天'])
    expect(searchKeywordTokens('a b cd')).toEqual(['cd'])
    expect(searchKeywordTokens('   ')).toEqual([])
  })
})

describe('trackMatchesKeyword', () => {
  const tokens = ['凡人修仙传', '大灰狼']

  it('标题 / 歌手命中任一 token 即可', () => {
    expect(trackMatchesKeyword({ title: '凡人修仙传 0001山边小村' }, tokens)).toBe(true)
    expect(trackMatchesKeyword({ title: '曾经的他', artist: '大灰狼' }, tokens)).toBe(true)
  })

  it('专辑名必须包含全部 token（避免把整张同 IP OST 带进来）', () => {
    // 专辑含「凡人修仙传」但不含「大灰狼」→ 不是用户要找的演播版本
    expect(
      trackMatchesKeyword({ title: '瞬间', artist: '谭维维', album: '凡人修仙传 电视剧原声专辑' }, tokens),
    ).toBe(false)
    // 专辑同时含两个 token → 放行
    expect(
      trackMatchesKeyword({ title: '瞬间', artist: '谭维维', album: '凡人修仙传 大灰狼 原声专辑' }, tokens),
    ).toBe(true)
  })

  it('完全不沾边则判否', () => {
    expect(
      trackMatchesKeyword({ title: 'Proud of Your Boy (Live)', artist: '丁辉', album: '声入人心 第1期' }, tokens),
    ).toBe(false)
  })

  it('无 token 时一律放行（单字查询等噪声场景不参与判定）', () => {
    expect(trackMatchesKeyword({ title: '随便' }, [])).toBe(true)
  })
})

describe('isFallbackSearchPage（上游兜底页检测）', () => {
  const tokens = ['凡人修仙传', '大灰狼']
  const hit = { title: '凡人修仙传 0001山边小村', artist: '大灰狼' }
  const miss = { title: 'Proud of Your Boy (Live)', artist: '丁辉', album: '声入人心 第1期' }

  it('满页且命中率低于阈值 → 判定为兜底页', () => {
    const page = [...Array.from({ length: 29 }, () => miss), hit]
    expect(isFallbackSearchPage(page, tokens)).toBe(true)
  })

  it('命中率较高 → 不是兜底页', () => {
    const page = [...Array.from({ length: 20 }, () => hit), ...Array.from({ length: 10 }, () => miss)]
    expect(isFallbackSearchPage(page, tokens)).toBe(false)
  })

  it('不满一页 / 无 token → 不判定（交给 searchPageHasMore 收尾）', () => {
    expect(isFallbackSearchPage([miss, miss], tokens)).toBe(false)
    expect(isFallbackSearchPage(Array.from({ length: SEARCH_PAGE_SIZE }, () => miss), [])).toBe(false)
  })

  it('阈值可调', () => {
    const page = [...Array.from({ length: 15 }, () => hit), ...Array.from({ length: 15 }, () => miss)]
    expect(isFallbackSearchPage(page, tokens, 0.6)).toBe(true)
    expect(isFallbackSearchPage(page, tokens, 0.3)).toBe(false)
  })
})
