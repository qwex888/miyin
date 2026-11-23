import { describe, it, expect } from 'vitest'
import {
  blockedOutcomeError,
  type BlockedReason,
} from '../server/utils/audioPreview'

/**
 * 收尾文案的归因正确性。
 *
 * 这三类失败对用户是**三种不同的行动**：
 * - 全试听 → 查会员 / 换音质
 * - 全内容坏 → 重试 / 换源（音源直链失效，与会员无关）
 * - 混合 → 两件事都要看
 *
 * 归因错一次，用户就会朝完全没用的方向排查一遍。
 */
function errOf(keys: string[], reasons: Record<string, BlockedReason>, hasMore: boolean) {
  return blockedOutcomeError(new Set(keys), reasons, hasMore)
}

describe('收尾错误按排除原因归因', () => {
  it('全是试听 → PREVIEW_CLIP，且区分是否还有组合没探查', () => {
    const keys = ['a@flac', 'b@flac']
    const reasons = { 'a@flac': 'preview', 'b@flac': 'preview' } as Record<string, BlockedReason>

    const noMore = errOf(keys, reasons, false)
    expect((noMore as any).code).toBe('PREVIEW_CLIP')
    expect(noMore.message).toContain('均只返回试听片段')
    expect(noMore.message).toContain('仅对会员开放')
    expect(noMore.message).not.toContain('重试')

    const more = errOf(keys, reasons, true)
    expect((more as any).code).toBe('PREVIEW_CLIP')
    expect(more.message).toContain('可点「重试」继续尝试其余音源')
  })

  it('全是内容坏 → INVALID_CONTENT，不再说成试听', () => {
    const keys = ['a@flac', 'b@flac']
    const reasons = { 'a@flac': 'invalid', 'b@flac': 'invalid' } as Record<string, BlockedReason>

    const err = errOf(keys, reasons, false)
    expect((err as any).code).toBe('INVALID_CONTENT')
    expect(err.message).toContain('均未返回可识别的音频内容')
    expect(err.message).not.toContain('试听')
    // 穷尽了：不该再吊着用户点重试
    expect(err.message).not.toContain('重试')
    expect((err as any).hasMore).toBe(false)
  })

  it('内容坏但还有组合没试 → 带上「可点重试」并标记 hasMore（重试门控靠它）', () => {
    const keys = ['a@flac', 'b@flac']
    const reasons = { 'a@flac': 'invalid', 'b@flac': 'invalid' } as Record<string, BlockedReason>

    const err = errOf(keys, reasons, true)
    expect((err as any).code).toBe('INVALID_CONTENT')
    expect((err as any).hasMore).toBe(true)
    expect(err.message).toContain('可点「重试」继续尝试其余音源')
  })

  it('混合场景（1 试听 + 1 内容坏）→ 两边数量都写出来，不冒充「均」', () => {
    const err = errOf(['a@flac', 'b@flac'], { 'a@flac': 'preview', 'b@flac': 'invalid' }, false)
    expect((err as any).code).toBe('INVALID_CONTENT')
    expect(err.message).toContain('1 个只返回试听片段')
    expect(err.message).toContain('1 个未返回可识别的音频内容')
    expect(err.message).not.toContain('均')
  })

  it('老任务只有排除 key、没有原因记录 → 按试听处理，不误报内容问题', () => {
    const err = errOf(['a@flac', 'b@flac'], {}, false)
    expect((err as any).code).toBe('PREVIEW_CLIP')
    expect(err.message).toContain('均只返回试听片段')
  })

  it('谎报档位（quality-lie）不算内容坏', () => {
    const err = errOf(
      ['a@flac24bit', 'b@flac'],
      { 'a@flac24bit': 'quality-lie', 'b@flac': 'quality-lie' },
      false,
    )
    expect((err as any).code).toBe('PREVIEW_CLIP')
    expect(err.message).not.toContain('未返回可识别的音频内容')
  })
})
