import { describe, expect, it } from 'vitest'
import { summarizeSourceCheck } from '../app/utils/sourceCheck'

describe('summarizeSourceCheck', () => {
  it('reports single dead source as error with message', () => {
    const r = summarizeSourceCheck([
      { id: '47eea5ce0d768696', status: 'dead', error: '初始化失败！请检查音源信息' },
    ])
    expect(r.level).toBe('error')
    expect(r.message).toContain('初始化失败！请检查音源信息')
  })

  it('reports all ok as success', () => {
    const r = summarizeSourceCheck([
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'ok' },
    ])
    expect(r.level).toBe('success')
    expect(r.message).toContain('全部通过')
  })

  it('reports mixed as warning', () => {
    const r = summarizeSourceCheck([
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'dead', error: '超时' },
    ])
    expect(r.level).toBe('warning')
    expect(r.message).toContain('通过 1')
    expect(r.message).toContain('失败 1')
  })
})
