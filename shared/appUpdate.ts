/** GitHub Release 附带的 latest.json 结构 */
export type MiyinLatestManifest = {
  version: string
  tag: string
  releasedAt: string
  changelog: string
  downloads: {
    releasePage: string
    fpk?: string
    dockerHub?: string
    ghcr?: string
  }
}

/** 服务端检测到的安装形态（更新弹窗按此展示指引） */
export type AppDeployMode = 'fnos' | 'docker' | 'other'

export type AppUpdateCheckResult = {
  current: string
  hasUpdate: boolean
  latest: MiyinLatestManifest | null
  deployMode: AppDeployMode
}

/** 解析 semver 核心段，pre-release 仅作同版本 tie-break（略简化） */
export function parseSemver(input: string): [number, number, number] | null {
  const m = String(input || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** a > b → 1；a === b → 0；a < b → -1；无法解析时返回 null */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1
    if (pa[i]! < pb[i]!) return -1
  }
  return 0
}

export function isNewerVersion(remote: string, current: string): boolean {
  const c = compareSemver(remote, current)
  return c === 1
}

/** 有新版本且用户未「忽略此版本」时展示导航红点 / 设置页提示 */
export function shouldShowAppUpdateBadge(
  hasUpdate: boolean,
  latestVersion: string | null | undefined,
  dismissedVersion: string | null | undefined,
): boolean {
  if (!hasUpdate) return false
  const ver = String(latestVersion || '').trim()
  if (!ver) return false
  return ver !== dismissedVersion
}

/** 已登录或开放模式、且不在登录页时，允许启动时检查更新 */
export function shouldRunBootUpdateCheck(input: {
  path: string
  authRequired: boolean
  loggedIn: boolean
}): boolean {
  if (input.path === '/login') return false
  if (input.authRequired && !input.loggedIn) return false
  return true
}
