import { describe, it, expect } from 'vitest'
import {
  isRetryableError,
  nextStatusAfterFailure,
} from '../server/services/downloadState'

describe('retryable errors', () => {
  it('detects disk full', () => {
    expect(isRetryableError(Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' }))).toBe(true)
    expect(isRetryableError(new Error('磁盘满'))).toBe(true)
  })

  it('detects network interruption', () => {
    expect(isRetryableError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('request timeout'))).toBe(true)
  })

  it('does not retry permanent client errors', () => {
    expect(isRetryableError(new Error('参数错误'))).toBe(false)
    expect(isRetryableError(new Error('未登录'))).toBe(false)
  })
})

describe('failure -> retry without resume', () => {
  it('requeues retryable network error even without alt source', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: false,
        retryable: true,
      }),
    ).toBe('queued')
  })

  it('requeues when alt source available', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: true,
        retryable: true,
      }),
    ).toBe('queued')
  })

  it('fails when attempts exhausted', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 3,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: true,
        retryable: true,
      }),
    ).toBe('failed')
  })

  it('fails non-retryable without alt source', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: false,
        retryable: false,
      }),
    ).toBe('failed')
  })

  // 「未登录」「该源无版权」「直链 404」对这个源是终态，对别的源未必是。
  // 早期实现先 `if (!retryable) return 'failed'` 短路，hasAltSource 永远拿不到
  // 控制权 —— 设置里开着「失败自动换源」，真该换源时却一步死。
  it('requeues non-retryable error when alt source available', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: true,
        retryable: false,
      }),
    ).toBe('queued')
  })

  it('still caps failover rounds by maxAttempts', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 3,
        maxAttempts: 3,
        autoFailover: true,
        hasAltSource: true,
        retryable: false,
      }),
    ).toBe('failed')
  })

  it('does not requeue when autoFailover is off', () => {
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: false,
        hasAltSource: true,
        retryable: true,
      }),
    ).toBe('failed')
    expect(
      nextStatusAfterFailure({
        attempts: 1,
        maxAttempts: 3,
        autoFailover: false,
        hasAltSource: false,
        retryable: false,
      }),
    ).toBe('failed')
  })
})
