import { z } from 'zod'
import { getDb } from '../utils/db'
import { assertDownloadDirWritable } from '../utils/downloadDir'

export const AppSettingsSchema = z.object({
  downloadDir: z.string().min(1),
  defaultQuality: z.enum(['highest', 'flac24bit', 'flac', '320k', '128k']).default('highest'),
  concurrency: z.number().int().min(1).max(5).default(1),
  downloadLyric: z.boolean().default(true),
  /** external=仅 .lrc；embedded=仅内嵌到音频 */
  lyricMode: z.enum(['external', 'embedded']).default('external'),
  nameTemplate: z.string().min(1).default('{artist} - {title}'),
  autoFailover: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(8).default(3),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>

export const NAME_TEMPLATE_VARS = [
  { key: '{artist}', desc: '歌手' },
  { key: '{title}', desc: '歌曲标题' },
  { key: '{album}', desc: '专辑名（可空）' },
  { key: '{platform}', desc: '平台代号，如 wy / kw / kg / tx' },
  { key: '{quality}', desc: '实际音质，如 320k / flac / flac24bit' },
  { key: '{id}', desc: '歌曲 externalId / songmid' },
  { key: '{track}', desc: '音轨号（有则写入，无则为空）' },
] as const

function envDownloadDir(): string | undefined {
  if (typeof process.env.DOWNLOAD_DIR === 'string' && process.env.DOWNLOAD_DIR.trim()) {
    return process.env.DOWNLOAD_DIR.trim()
  }
  if (typeof process.env.NUXT_DOWNLOAD_DIR === 'string' && process.env.NUXT_DOWNLOAD_DIR.trim()) {
    return process.env.NUXT_DOWNLOAD_DIR.trim()
  }
  return undefined
}

const DEFAULTS: AppSettings = {
  downloadDir: './downloads',
  defaultQuality: 'highest',
  concurrency: 1,
  downloadLyric: true,
  lyricMode: 'external',
  nameTemplate: '{artist} - {title}',
  autoFailover: true,
  maxAttempts: 3,
}

export function getSettings(): AppSettings {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app') as { value: string } | undefined
  let stored: Partial<AppSettings> = {}
  if (row?.value) {
    try {
      stored = JSON.parse(row.value)
    } catch {
      stored = {}
    }
  }
  const merged = AppSettingsSchema.parse({ ...DEFAULTS, ...stored })
  // 飞牛 main / Docker 注入的 DOWNLOAD_DIR 优先于库内值
  const fromEnv = envDownloadDir()
  if (fromEnv) merged.downloadDir = fromEnv
  return merged
}

export function saveSettings(input: Partial<AppSettings>) {
  const next = AppSettingsSchema.parse({ ...getSettings(), ...input })
  assertDownloadDirWritable(next.downloadDir)
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run('app', JSON.stringify(next))
  return next
}

export function ensureWritableDir(dir: string) {
  return assertDownloadDirWritable(dir)
}
