import { z } from 'zod'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { getDb } from '../utils/db'
import { getDownloadDir } from '../utils/paths'

export const AppSettingsSchema = z.object({
  downloadDir: z.string().min(1),
  defaultQuality: z.enum(['highest', 'flac', '320k', '128k']).default('highest'),
  concurrency: z.number().int().min(1).max(5).default(2),
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
  { key: '{quality}', desc: '实际音质，如 320k / flac' },
  { key: '{id}', desc: '歌曲 externalId / songmid' },
  { key: '{track}', desc: '音轨号（有则写入，无则为空）' },
] as const

const DEFAULTS: AppSettings = {
  downloadDir: process.env.DOWNLOAD_DIR || './downloads',
  defaultQuality: 'highest',
  concurrency: 2,
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
  if (process.env.DOWNLOAD_DIR) {
    merged.downloadDir = process.env.DOWNLOAD_DIR
  }
  return merged
}

export function saveSettings(input: Partial<AppSettings>) {
  const next = AppSettingsSchema.parse({ ...getSettings(), ...input })
  ensureWritableDir(next.downloadDir)
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run('app', JSON.stringify(next))
  return next
}

export function ensureWritableDir(dir: string) {
  const resolved = getDownloadDir(dir)
  try {
    mkdirSync(resolved, { recursive: true })
    accessSync(resolved, constants.W_OK)
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: `下载目录不可写: ${resolved} (${err?.message || err})`,
    })
  }
  return resolved
}
