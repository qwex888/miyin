import { accessSync, constants, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resolveDownloadDir } from './paths'

export const DOWNLOAD_DIR_PERM_CODE = 'EACCES'

/** 是否为目录/文件权限类错误（不可自动重试） */
export function isDownloadPermissionError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toUpperCase()
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return true
  const msg = String((err as any)?.message || err || '')
  return /无下载目录写入权限|下载目录不可写|permission denied|read-only file system|erofs/i.test(msg)
}

export function formatDownloadPermissionMessage(resolved: string) {
  return `无下载目录写入权限: ${resolved}（Docker/飞牛请检查卷挂载与目录属主是否可写）`
}

/**
 * 实际探测能否在下载目录创建文件（比 accessSync 更可靠，覆盖 Docker 挂载覆盖镜像目录等场景）。
 * 失败时抛出带 code=EACCES 的 Error（非 HTTP createError，供 worker 使用）。
 */
export function ensureDownloadDirWritable(dir: string): string {
  const resolved = resolveDownloadDir(dir)
  let probe: string | null = null
  try {
    mkdirSync(resolved, { recursive: true })
    accessSync(resolved, constants.W_OK)
    probe = join(
      resolved,
      `.miyin-write-probe-${process.pid}-${randomBytes(4).toString('hex')}`,
    )
    writeFileSync(probe, 'ok', { flag: 'w' })
    unlinkSync(probe)
    probe = null
  } catch (err: any) {
    if (probe) {
      try {
        unlinkSync(probe)
      } catch {
        /* ignore */
      }
    }
    if (err?.code === 'ENOSPC') {
      const e = new Error(`下载目录磁盘空间不足: ${resolved}`)
      ;(e as any).code = 'ENOSPC'
      throw e
    }
    const e = new Error(formatDownloadPermissionMessage(resolved))
    ;(e as any).code = DOWNLOAD_DIR_PERM_CODE
    throw e
  }
  return resolved
}

/** API / 入队路径：不可写时直接 400，前端可展示 statusMessage */
export function assertDownloadDirWritable(dir: string): string {
  try {
    return ensureDownloadDirWritable(dir)
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message || formatDownloadPermissionMessage(String(dir)),
      data: { code: err?.code || DOWNLOAD_DIR_PERM_CODE },
    })
  }
}
