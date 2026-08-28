import { getSource, listEnabledOkSources, type SourceRow } from './sourceRegistry'
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
 * 根据偏好与音源宣称的 qualitys 生成尝试列表（单音源视角，供旧逻辑/单测）。
 * - highest：按阶梯降级，只保留音源支持的项
 * - 固定音质：仅该项
 */
export function buildQualityAttempts(available: string[], preferred: string): string[] {
  if (isHighestQuality(preferred)) {
    const set = new Set(available.map(String))
    const ladder = QUALITY_LADDER.filter((q) => set.has(q))
    if (ladder.length) return [...ladder]
    return ['flac', '320k', '128k']
  }
  return [preferred]
}

/** 全局音质阶梯：highest 时取各源宣称音质并集，再按 QUALITY_LADDER 排序 */
export function buildGlobalQualityLadder(preferred: string, availableLists: string[][]): string[] {
  if (!isHighestQuality(preferred)) return [preferred]
  const union = new Set<string>()
  for (const list of availableLists) {
    for (const q of list) union.add(String(q))
  }
  const ladder = QUALITY_LADDER.filter((q) => union.has(q))
  if (ladder.length) return [...ladder]
  return ['flac', '320k', '128k']
}

/** 任务指定 sourceId 时排首位，但仍会轮询其余音源 */
export function orderSourcesForResolve(all: SourceRow[], sourceId?: string | null): SourceRow[] {
  if (!sourceId) return all
  const primary = getSource(sourceId)
  if (!primary) return all
  return [primary, ...all.filter((s) => s.id !== sourceId)]
}

export function shouldTryQualityOnSource(
  available: string[],
  quality: string,
  highest: boolean,
): boolean {
  if (!highest) return true
  return available.includes(quality)
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
  /** 优先尝试的音源（仍轮询全部音源） */
  sourceId?: string | null
}

type LoadedSource = {
  source: SourceRow
  handle: Awaited<ReturnType<typeof loadLxSource>>
  available: string[]
}

/**
 * 取链：先按音质档位、再轮询全部音源。
 * - highest：每档试遍所有源，全失败再降档
 * - 固定音质：该档试遍所有源
 */
export async function resolveMusicUrl(input: ResolveMusicUrlInput): Promise<ResolveMusicUrlResult> {
  const preferred = input.quality || 'highest'
  const highest = isHighestQuality(preferred)
  const musicInfo = normalizeMusicInfo(input.musicInfo)

  const all = listEnabledOkSources(input.platform)
  if (!all.length) {
    throw Object.assign(new Error(`没有可用音源支持平台 ${input.platform}`), { code: 'NO_SOURCE' })
  }

  const ordered = orderSourcesForResolve(all, input.sourceId)
  const errors: string[] = []
  const loaded: LoadedSource[] = []

  for (const source of ordered) {
    if (!source?.local_path) {
      errors.push(`${source?.name || source?.id || '?'}: 音源文件缺失`)
      continue
    }
    try {
      const handle = await loadLxSource(source.local_path)
      const available = handle.qualityMap[input.platform] || ['128k', '320k']
      if (!highest && !available.includes(preferred)) {
        errors.push(`${source.name}: 未宣称支持 ${preferred}，仍尝试取链`)
      }
      loaded.push({ source, handle, available })
    } catch (err: any) {
      const msg = err?.message || String(err)
      errors.push(`${source.name}: 加载失败（${msg}）`)
    }
  }

  if (!loaded.length) {
    const detail = errors.slice(0, 12).join(' | ') || '无可用音源'
    throw Object.assign(new Error(`取链失败：${detail}`), { code: 'NO_SOURCE' })
  }

  const tiers = buildGlobalQualityLadder(
    preferred,
    loaded.map((l) => l.available),
  )

  for (const q of tiers) {
    for (const { source, handle, available } of loaded) {
      if (!shouldTryQualityOnSource(available, q, highest)) continue
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
      }
    }
  }

  const detail = errors.slice(0, 12).join(' | ') || '无详细错误'
  throw Object.assign(
    new Error(
      highest
        ? `取链失败（已轮询 ${loaded.length} 个音源并尝试降级）：${detail}`
        : `取链失败（已轮询 ${loaded.length} 个音源）：${detail}`,
    ),
    { code: 'GET_URL_FAILED' },
  )
}

/** 供单测 / 旧调用：从 available 选一个首选音质 */
export function pickQuality(available: string[], preferred: string) {
  const attempts = buildQualityAttempts(available, preferred)
  return attempts[0] || (preferred === 'highest' ? '320k' : preferred)
}
