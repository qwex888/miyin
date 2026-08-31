import { describe, it, expect } from 'vitest'
import { searchPlatform } from '../server/services/platformSearch'

describe('platformSearch variable declarations', () => {
  it('does not throw ReferenceError for songs in searchWy', async () => {
    try {
      // 真实请求网易云公共接口搜索
      const res = await searchPlatform('wy', '晴天 周杰伦', 1)
      expect(Array.isArray(res)).toBe(true)
      expect(res.length).toBeGreaterThan(0)
      expect(res[0].title).toBeDefined()
    } catch (e: any) {
      // 如果无网或超时，不应是 ReferenceError
      expect(e.message).not.toContain('songs is not defined')
      expect(e.message).not.toContain('ReferenceError')
    }
  })
})
