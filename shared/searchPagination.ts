/** 各平台搜索单页条数（与 platformSearch / platformAlbum 上游 limit 对齐） */
export const SEARCH_PAGE_SIZE = 30

/**
 * 是否还有下一页：仅当本页「满页」才继续加载。
 * 空页 / 不满一页 → false，避免触底后空转或无限请求。
 */
export function searchPageHasMore(pageItemCount: number, pageSize = SEARCH_PAGE_SIZE): boolean {
  return pageItemCount >= pageSize
}
