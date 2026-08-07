/** 平台 / 音质展示文案（队列、列表等复用） */

const PLATFORM_LABELS: Record<string, string> = {
  wy: '网易云',
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  mg: '咪咕',
}

const QUALITY_LABELS: Record<string, string> = {
  highest: '最高可用',
  flac24bit: 'Hi-Res',
  flac: '无损',
  '320k': '320k',
  '128k': '128k',
}

/** 可选下载音质（与设置 / 入队一致） */
export const DOWNLOAD_QUALITY_OPTIONS = [
  { id: 'highest', label: '最高可用（多源轮询+降级）' },
  { id: 'flac24bit', label: 'flac24bit（Hi-Res）' },
  { id: 'flac', label: 'flac（无损）' },
  { id: '320k', label: '320k' },
  { id: '128k', label: '128k' },
] as const

export type DownloadQuality = (typeof DOWNLOAD_QUALITY_OPTIONS)[number]['id']

export function isDownloadQuality(v: unknown): v is DownloadQuality {
  return typeof v === 'string' && DOWNLOAD_QUALITY_OPTIONS.some((o) => o.id === v)
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform
}

export function qualityLabel(quality: string): string {
  return QUALITY_LABELS[quality] || quality
}
