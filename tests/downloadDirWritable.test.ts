import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  ensureDownloadDirWritable,
  isDownloadPermissionError,
} from '../server/utils/downloadDir'
import { isRetryableError } from '../server/services/downloadState'

describe('download dir writability', () => {
  it('probe succeeds on writable dir', () => {
    const dir = join(tmpdir(), `miyin-write-ok-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      expect(ensureDownloadDirWritable(dir)).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('probe fails on read-only dir with clear message', () => {
    const dir = join(tmpdir(), `miyin-write-ro-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      chmodSync(dir, 0o555)
      expect(() => ensureDownloadDirWritable(dir)).toThrow(/无下载目录写入权限/)
      try {
        ensureDownloadDirWritable(dir)
      } catch (err: any) {
        expect(err.code).toBe('EACCES')
        expect(isDownloadPermissionError(err)).toBe(true)
        expect(isRetryableError(err)).toBe(false)
      }
    } finally {
      chmodSync(dir, 0o755)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('permission errors are not retryable', () => {
    expect(
      isRetryableError(Object.assign(new Error('无下载目录写入权限: /downloads'), { code: 'EACCES' })),
    ).toBe(false)
    expect(isRetryableError(Object.assign(new Error('EPERM'), { code: 'EPERM' }))).toBe(false)
  })
})
