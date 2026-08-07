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

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform
}

export function qualityLabel(quality: string): string {
  return QUALITY_LABELS[quality] || quality
}
