import { getSource, listEnabledOkSources } from './sourceRegistry'
import { loadLxSource } from './sourceRuntime'

/** 音质从高到低（highest 降级阶梯） */
export const QUALITY_LADDER = ['flac24bit', 'flac', '320k', '192k', '128k'] as const

export function isHighestQuality(pref: string | null | undefined): boolean {
  return !pref || pref === 'highest'
}

/** 补齐 id/songmid/hash，兼容洛雪/部分音源只认 id */
export function normalizeMusicInfo(musicInfo: Record<string, any>): Record<string, any> {
  const id = musicInfo.id || musicInfo.songmid || musicInfo.hash || musicInfo.songId
  if (id == null || id === '') return { ...musicInfo }
  const sid = String(id)
  return {
    ...musicInfo,
    id: musicInfo.id != null && musicInfo.id !== '' ? String(musicInfo.id) : sid,
    songmid: musicInfo.songmid != null && musicInfo.songmid !== '' ? String(musicInfo.songmid) : sid,
    hash: musicInfo.hash != null && musicInfo.hash !== '' ? String(musicInfo.hash) : sid,
  }
}

/**
 * 根据偏好与音源宣称的 qualitys 生成尝试列表。
 * - highest：按阶梯降级，只保留音源支持的项
 * - 固定音质：仅该项（即便不在 available 也仍尝试一次，由音源返回明确错误）
 */
export function buildQualityAttempts(available: string[], preferred: string): string[] {
  if (isHighestQuality(preferred)) {
    const set = new Set(available.map(String))
    const ladder = QUALITY_LADDER.filter((q) => set.has(q))
    if (ladder.length) return [...ladder]
    // 音源未声明时：按阶梯试常见值
    return ['flac', '320k', '128k']
  }
  return [preferred]
}

export type ResolveMusicUrlResult = {
  url: string
  quality: string
  sourceId: string
  sourceName: string
}

export type ResolveMusicUrlInput = {
  platform: string
  musicInfo: Record<string, any>
  /** highest | flac24bit | flac | 320k | 128k ... */
  quality: string
  /** 优先 / 唯一音源（固定音质时只用它） */
  sourceId?: string | null
}

/**
 * 取链：
 * - highest：音源列表轮询 + 音质阶梯降级
 * - 固定音质：仅当前音源、仅该音质；失败即抛出带原因的错误
 */
export async function resolveMusicUrl(input: ResolveMusicUrlInput): Promise<ResolveMusicUrlResult> {
  const preferred = input.quality || 'highest'
  const highest = isHighestQuality(preferred)
  const musicInfo = normalizeMusicInfo(input.musicInfo)

  const all = listEnabledOkSources(input.platform)
  if (!all.length) {
    throw Object.assign(new Error(`没有可用音源支持平台 ${input.platform}`), { code: 'NO_SOURCE' })
  }

  let ordered = all
  if (input.sourceId) {
    const primary = getSource(input.sourceId)
    ordered = [
      ...(primary ? [primary] : []),
      ...all.filter((s) => s.id !== input.sourceId),
    ]
  }

  if (!highest) {
    // 固定音质：只用指定源（或列表第一个），不轮询其它源
    const only = input.sourceId ? getSource(input.sourceId) : ordered[0]
    if (!only?.local_path) {
      throw Object.assign(new Error('音源文件缺失或不可用'), { code: 'NO_SOURCE' })
    }
    ordered = [only]
  }

  const errors: string[] = []

  for (const source of ordered) {
    if (!source?.local_path) {
      errors.push(`${source?.name || source?.id || '?'}: 音源文件缺失`)
      if (!highest) break
      continue
    }
    let handle
    try {
      handle = await loadLxSource(source.local_path)
    } catch (err: any) {
      const msg = err?.message || String(err)
      errors.push(`${source.name}: 加载失败（${msg}）`)
      if (!highest) {
        throw Object.assign(new Error(`音源「${source.name}」加载失败：${msg}`), {
          code: 'SOURCE_LOAD',
          cause: err,
        })
      }
      continue
    }

    const available = handle.qualityMap[input.platform] || ['128k', '320k']
    const qualities = buildQualityAttempts(available, preferred)

    if (!highest && !available.includes(preferred)) {
      // 仍尝试一次，但错误信息更明确
      errors.push(`${source.name}: 未宣称支持 ${preferred}，仍尝试取链`)
    }

    for (const q of qualities) {
      try {
        const url = await handle.getMusicUrl(input.platform, musicInfo, q)
        return {
          url,
          quality: q,
          sourceId: source.id,
          sourceName: source.name,
        }
      } catch (err: any) {
        const msg = err?.message || String(err)
        errors.push(`${source.name}@${q}: ${msg}`)
        if (!highest) {
          throw Object.assign(
            new Error(`音源「${source.name}」无法获取 ${preferred} 音质：${msg}`),
            { code: 'GET_URL_FIXED', cause: err },
          )
        }
      }
    }
  }

  const detail = errors.slice(0, 12).join(' | ') || '无详细错误'
  throw Object.assign(
    new Error(
      highest
        ? `取链失败（已轮询 ${ordered.length} 个音源并尝试降级）：${detail}`
        : `取链失败：${detail}`,
    ),
    { code: 'GET_URL_FAILED' },
  )
}

/** 供单测 / 旧调用：从 available 选一个首选音质 */
export function pickQuality(available: string[], preferred: string) {
  const attempts = buildQualityAttempts(available, preferred)
  return attempts[0] || (preferred === 'highest' ? '320k' : preferred)
}
