import { describe, it, expect } from 'vitest'
import { searchPlatform } from '../server/services/platformSearch'

describe('platformSearch variable declarations across all platforms', () => {
  const platforms: Array<'wy' | 'kw' | 'kg' | 'tx'> = ['wy', 'kw', 'kg', 'tx']

  for (const p of platforms) {
    it(`does not throw ReferenceError and returns valid SearchTrack structures for ${p}`, async () => {
      try {
        const res = await searchPlatform(p, '周杰伦', 1)
        expect(Array.isArray(res)).toBe(true)
        if (res.length > 0) {
          const first = res[0]
          expect(first.id).toBeDefined()
          expect(first.id.startsWith(`${p}:`)).toBe(true)
          expect(first.externalId).toBeDefined()
          expect(typeof first.externalId).toBe('string')
          expect(first.externalId.length).toBeGreaterThan(0)
          expect(first.title).toBeDefined()
          expect(first.artist).toBeDefined()
          expect(first.platform).toBe(p)
          expect(first.musicInfo).toBeDefined()
          expect(first.musicInfo.source).toBe(p)
          expect(first.musicInfo.songmid || first.musicInfo.hash).toBeDefined()
        }
      } catch (e: unknown) {
        const err = e as Error
        // 如果外部接口网络不通或偶发超时，断言绝不出现 ReferenceError 或变量未定义错误
        expect(err.name).not.toBe('ReferenceError')
        expect(err.message).not.toContain('is not defined')
        expect(err.message).not.toContain('ReferenceError')
      }
    })
  }
})
