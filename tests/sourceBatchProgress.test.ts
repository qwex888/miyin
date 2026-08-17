import { describe, expect, it } from 'vitest'
import {
  SOURCE_BATCH_TIMEOUT_CAP_MS,
  SOURCE_ITEM_TIMEOUT_MS,
  formatSourceProgressText,
  sourceBatchTimeoutMs,
} from '../shared/sourceBatchProgress'
import { withTimeout, SourceBatchTimeoutError } from '../server/utils/sourceBatchTimeout'

describe('source batch progress helpers', () => {
  it('formats progress text', () => {
    expect(
      formatSourceProgressText({
        index: 1,
        total: 23,
        name: '星海',
        status: 'loading',
      }),
    ).toBe('当前进度：【1/23】音源：[星海]，状态：加载中')
  })

  it('batch timeout is min(5min, n * item)', () => {
    expect(sourceBatchTimeoutMs(1)).toBe(SOURCE_ITEM_TIMEOUT_MS)
    expect(sourceBatchTimeoutMs(5)).toBe(5 * SOURCE_ITEM_TIMEOUT_MS)
    expect(sourceBatchTimeoutMs(1000)).toBe(SOURCE_BATCH_TIMEOUT_CAP_MS)
  })

  it('withTimeout rejects after ms', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 30, '单元'),
    ).rejects.toBeInstanceOf(SourceBatchTimeoutError)
  })
})
