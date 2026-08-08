export type SourceCheckItem = {
  id: string
  status: string
  error?: string
}

/** 根据 /api/sources/check 的 items 生成提示文案与级别 */
export function summarizeSourceCheck(items: SourceCheckItem[]): {
  level: 'success' | 'warning' | 'error'
  message: string
} {
  if (!items.length) {
    return { level: 'warning', message: '没有可检测的音源' }
  }

  const ok = items.filter((i) => i.status === 'ok')
  const bad = items.filter((i) => i.status !== 'ok')

  if (!bad.length) {
    return {
      level: 'success',
      message: items.length === 1 ? '检测通过' : `检测完成：全部通过（${ok.length}）`,
    }
  }

  const firstErr = bad.find((b) => b.error)?.error || bad[0]?.status || '不可用'

  if (items.length === 1) {
    return { level: 'error', message: `检测失败：${firstErr}` }
  }

  if (!ok.length) {
    return {
      level: 'error',
      message: `检测完成：全部失败（${bad.length}），如：${firstErr}`,
    }
  }

  return {
    level: 'warning',
    message: `检测完成：通过 ${ok.length}，失败 ${bad.length}（如：${firstErr}）`,
  }
}
