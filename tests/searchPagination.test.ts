import { describe, expect, it } from 'vitest'
import { SEARCH_PAGE_SIZE, searchPageHasMore } from '../shared/searchPagination'

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
