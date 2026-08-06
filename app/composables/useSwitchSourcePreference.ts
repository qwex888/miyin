/** 换源默认音源（全局 + 按平台备份，用于跨平台批量） */

const LS_GLOBAL = 'miyin-switch-source-id'
const LS_BY_PLATFORM = 'miyin-switch-source-by-platform'

export type SwitchSourceOption = {
  id: string
  name: string
  platforms: string[]
}

function readByPlatform(): Record<string, string> {
  if (!import.meta.client) return {}
  try {
    const raw = localStorage.getItem(LS_BY_PLATFORM)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeByPlatform(map: Record<string, string>) {
  if (!import.meta.client) return
  localStorage.setItem(LS_BY_PLATFORM, JSON.stringify(map))
}

export function getPreferredSwitchSourceId(): string | null {
  if (!import.meta.client) return null
  return localStorage.getItem(LS_GLOBAL) || null
}

/** 记住全局默认，并写入该源支持的各平台 */
export function rememberSwitchSource(source: SwitchSourceOption) {
  if (!import.meta.client) return
  localStorage.setItem(LS_GLOBAL, source.id)
  const map = readByPlatform()
  for (const p of source.platforms) {
    if (p) map[p] = source.id
  }
  writeByPlatform(map)
}

/** 在可选列表中解析默认选中项：全局记住 > 列表第一项 */
export function resolveDefaultSwitchSourceId(options: SwitchSourceOption[]): string | null {
  if (!options.length) return null
  const preferred = getPreferredSwitchSourceId()
  if (preferred && options.some((o) => o.id === preferred)) return preferred
  return options[0]!.id
}

/**
 * 为某个平台解析实际要用的音源：
 * 优先所选源（若支持该平台）→ 平台记住 → 列表第一项
 */
export function resolveSourceIdForPlatform(
  platform: string,
  optionsForPlatform: SwitchSourceOption[],
  selected: SwitchSourceOption | null,
): string | null {
  if (!optionsForPlatform.length) return null
  if (selected?.platforms.includes(platform)) {
    if (optionsForPlatform.some((o) => o.id === selected.id)) return selected.id
  }
  const byPlatform = readByPlatform()[platform]
  if (byPlatform && optionsForPlatform.some((o) => o.id === byPlatform)) return byPlatform
  return optionsForPlatform[0]!.id
}

export function useSwitchSourcePreference() {
  return {
    getPreferredSwitchSourceId,
    rememberSwitchSource,
    resolveDefaultSwitchSourceId,
    resolveSourceIdForPlatform,
  }
}
