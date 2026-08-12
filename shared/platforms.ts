/**
 * 平台代号（与洛雪音源 source 字段一致，不要轻易改 key）。
 * 展示文案只改 PLATFORM_DISPLAY 的 value，全站 UI / API 提示会跟着变。
 */
export const PLATFORM = {
  wy: 'wy',
  kw: 'kw',
  kg: 'kg',
  tx: 'tx',
  mg: 'mg',
} as const

export type PlatformId = (typeof PLATFORM)[keyof typeof PLATFORM]

/** key = 内部代号；value = 对外展示。需要换皮时只改这里。 */
export const PLATFORM_DISPLAY: Record<PlatformId, string> = {
  wy: 'wy',
  kw: 'kw',
  kg: 'kg',
  tx: 'tx',
  mg: 'mg',
}

export const SEARCH_PLATFORM_ORDER: PlatformId[] = ['wy', 'kw', 'kg', 'tx']
export const PLAYLIST_PLATFORM_ORDER: PlatformId[] = ['wy', 'tx', 'kg']

export function isPlatformId(v: string): v is PlatformId {
  return v in PLATFORM_DISPLAY
}

export function platformLabel(id: string): string {
  return PLATFORM_DISPLAY[id as PlatformId] || id
}

export function platformListText(ids: readonly string[], sep = ' / '): string {
  return ids.map(platformLabel).join(sep)
}
