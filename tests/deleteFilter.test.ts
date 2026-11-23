import { describe, it, expect } from 'vitest'
import { parseDeleteFilter, resolveDeleteRequest } from '../server/utils/deleteFilter'

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn()
    return undefined
  } catch (e: any) {
    return e?.statusCode
  }
}

describe('parseDeleteFilter fail-closed', () => {
  it('maps known fields and trims values', () => {
    expect(
      parseDeleteFilter({
        playlist_url: ' http://x/p ',
        batch_id: 'b1',
        q: ' 稻香 ',
        platform: 'wy',
        quality: '128k',
        since: '2026-11-01',
        until: '2026-11-30',
      }),
    ).toEqual({
      playlistUrl: 'http://x/p',
      batchId: 'b1',
      q: '稻香',
      platform: 'wy',
      quality: '128k',
      since: '2026-11-01',
      until: '2026-11-30',
    })
  })

  it('treats undefined, null and an empty object as no filter', () => {
    expect(parseDeleteFilter(undefined)).toEqual({})
    expect(parseDeleteFilter(null)).toEqual({})
    expect(parseDeleteFilter({})).toEqual({})
  })

  it('rejects non-object input', () => {
    expect(statusOf(() => parseDeleteFilter([]))).toBe(400)
    expect(statusOf(() => parseDeleteFilter('128k'))).toBe(400)
    expect(statusOf(() => parseDeleteFilter(320))).toBe(400)
  })

  it('rejects unknown field names', () => {
    expect(statusOf(() => parseDeleteFilter({ quality_filter: '128k' }))).toBe(400)
  })

  it('rejects non-string and blank values', () => {
    expect(statusOf(() => parseDeleteFilter({ quality: 320 }))).toBe(400)
    expect(statusOf(() => parseDeleteFilter({ platform: ['wy'] }))).toBe(400)
    // 删除路径不允许「空串 = 未设置」，否则条件会静默消失
    expect(statusOf(() => parseDeleteFilter({ quality: '  ' }))).toBe(400)
  })

  it('rejects dates that are not real YYYY-MM-DD values', () => {
    expect(statusOf(() => parseDeleteFilter({ since: '2026/11/01' }))).toBe(400)
    expect(statusOf(() => parseDeleteFilter({ until: '2026-02-31' }))).toBe(400)
    expect(statusOf(() => parseDeleteFilter({ since: '2026-13-01' }))).toBe(400)
  })
})

describe('resolveDeleteRequest', () => {
  it('requires ids or a valid tab', () => {
    expect(statusOf(() => resolveDeleteRequest({}))).toBe(400)
    expect(statusOf(() => resolveDeleteRequest(undefined))).toBe(400)
  })

  it('rejects invalid allWithTab values', () => {
    expect(statusOf(() => resolveDeleteRequest({ allWithTab: 'running' }))).toBe(400)
    expect(statusOf(() => resolveDeleteRequest({ allWithTab: 'failed ', ids: ['a'] }))).toBe(400)
  })

  it('rejects malformed ids', () => {
    expect(statusOf(() => resolveDeleteRequest({ ids: 'a' }))).toBe(400)
    expect(statusOf(() => resolveDeleteRequest({ ids: [1] }))).toBe(400)
    expect(statusOf(() => resolveDeleteRequest({ ids: ['  '] }))).toBe(400)
  })

  it('returns normalized scope with ids taking precedence', () => {
    expect(resolveDeleteRequest({ ids: [' a '], filters: { quality: '128k' } })).toEqual({
      ids: ['a'],
      tab: undefined,
      filter: { quality: '128k' },
    })
    expect(resolveDeleteRequest({ allWithTab: 'completed', filters: { quality: '128k' } })).toEqual({
      ids: undefined,
      tab: 'completed',
      filter: { quality: '128k' },
    })
  })

  it('rejects malformed filters even when ids are provided', () => {
    expect(statusOf(() => resolveDeleteRequest({ ids: ['a'], filters: { quality: 320 } }))).toBe(400)
  })
})
