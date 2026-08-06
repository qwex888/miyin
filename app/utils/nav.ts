export type NavLink = {
  to: string
  label: string
  short: string
  badge?: boolean
}

export const APP_NAV_LINKS: NavLink[] = [
  { to: '/', label: '搜索', short: '搜索' },
  { to: '/playlist', label: '歌单', short: '歌单' },
  { to: '/queue', label: '下载队列', short: '队列', badge: true },
  { to: '/sources', label: '音源管理', short: '音源' },
  { to: '/settings', label: '设置', short: '设置' },
]

export function navLinkActive(path: string, to: string) {
  return path === to
}
