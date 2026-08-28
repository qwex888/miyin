import { describe, expect, it } from 'vitest'
import {
  classifySourceError,
  listProbeTargets,
  PROBE_PLATFORM_ORDER,
} from '../server/services/sourceProbe'
import type { LxSourceHandle } from '../server/services/sourceRuntime'

describe('classifySourceError', () => {
  it('detects service suspended', () => {
    expect(classifySourceError('unknow error')).toContain('API 返回异常')
    expect(classifySourceError('<!DOCTYPE html> Service Suspended')).toContain('API 服务已停服')
  })

  it('detects DNS failure', () => {
    expect(classifySourceError('getaddrinfo ENOTFOUND api.example.com')).toContain('DNS')
  })

  it('detects API key issues', () => {
    expect(classifySourceError('Key失效/鉴权失败')).toContain('API Key')
  })

  it('detects HTTP 404 with version hint', () => {
    const msg = classifySourceError('HTTP 404 Not Found', {
      updateAlerts: ['当前源脚本版本过低(v4)，请下载最新版本(v5)'],
    })
    expect(msg).toContain('404')
    expect(msg).toContain('版本过低')
  })

  it('detects rate limit and IP block', () => {
    expect(classifySourceError('too many requests')).toContain('限流')
    expect(classifySourceError('block ip')).toContain('IP 被封禁')
  })

  it('detects server errors', () => {
    expect(classifySourceError('internal server error')).toContain('500')
    expect(classifySourceError('500 Internal Server Error')).toContain('500')
  })

  it('detects timeout', () => {
    expect(classifySourceError('取链探针超时（12s）')).toContain('超时')
  })
})

describe('listProbeTargets', () => {
  it('orders platforms by probe priority', () => {
    const handle = {
      platforms: ['kg', 'wy', 'tx'],
      qualityMap: {
        wy: ['128k'],
        kg: ['320k'],
        tx: ['128k'],
      },
      updateAlerts: [],
    } as LxSourceHandle

    const targets = listProbeTargets(handle)
    expect(targets.map((t) => t.platform)).toEqual(['wy', 'kg', 'tx'])
    expect(targets[0]!.quality).toBe('128k')
    expect(targets[1]!.quality).toBe('320k')
  })

  it('skips platforms without probe track', () => {
    const handle = {
      platforms: ['git', 'local'],
      qualityMap: { git: ['128k'], local: ['128k'] },
      updateAlerts: [],
    } as LxSourceHandle
    expect(listProbeTargets(handle)).toEqual([])
  })

  it('covers all probe platform keys', () => {
    for (const p of PROBE_PLATFORM_ORDER) {
      expect(listProbeTargets({
        platforms: [p],
        qualityMap: { [p]: ['128k'] },
        updateAlerts: [],
      } as LxSourceHandle).length).toBe(1)
    }
  })
})
