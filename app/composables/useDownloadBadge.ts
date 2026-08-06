/**
 * @deprecated 请优先用 useDownloadEvents；保留此文件避免旧引用断裂。
 */
export function useDownloadBadge() {
  const { activeCount, refresh, startWatching, notifyChanged } = useDownloadEvents()
  return { activeCount, refresh, startWatching, notifyChanged }
}
