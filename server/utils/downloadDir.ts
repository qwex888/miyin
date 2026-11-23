import { accessSync, constants, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resolveDownloadDir } from './paths'

export const DOWNLOAD_DIR_PERM_CODE = 'EACCES'

/** 本地环境类错误：换源/重试都没意义，重跑只会把同一句话重复 N 次 */
const LOCAL_FS_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR'])

/** 是否为目录/文件权限类错误（不可自动重试） */
export function isDownloadPermissionError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toUpperCase()
  if (LOCAL_FS_CODES.has(code)) return true
  const msg = String((err as any)?.message || err || '')
  return /无下载目录写入权限|下载目录不可写|下载目录路径不存在|下载路径中有同名文件|permission denied|read-only file system|erofs/i.test(
    msg,
  )
}

export function formatDownloadPermissionMessage(resolved: string) {
  return `无下载目录写入权限: ${resolved}（Docker/飞牛请检查卷挂载与目录属主是否可写）`
}

/**
 * 按 errno 给出可执行的处置建议。
 *
 * 早先所有非 ENOSPC 的异常都报「无下载目录写入权限」，于是只读挂载、路径不存在、
 * SELinux 拒绝、属主不对，用户看到的都是同一句「请检查卷挂载与目录属主」——
 * 对着只读卷调属主是白费功夫。这几种的处置方式完全不同，必须分开说。
 */
export function describeDownloadDirFailure(code: string, resolved: string, fallback?: string): string {
  switch (code) {
    case 'ENOSPC':
      return `下载目录磁盘空间不足: ${resolved}（清理文件或扩容后重试）`
    case 'EROFS':
      return `下载目录所在卷为只读挂载: ${resolved}（检查卷/挂载参数，取消只读后重试）`
    case 'ENOENT':
      return `下载目录路径不存在且无法创建: ${resolved}（检查挂载点与上级目录是否存在）`
    case 'ENOTDIR':
      return `下载路径中有同名文件占位，无法创建目录: ${resolved}（重命名该文件后重试）`
    case 'EDQUOT':
      return `下载目录超出配额限制: ${resolved}（清理文件或调整配额）`
    case 'EACCES':
    case 'EPERM':
      return formatDownloadPermissionMessage(resolved)
    default:
      return fallback ?? `下载目录不可写: ${resolved}（${code || '未知错误'}）`
  }
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
    const code = String(err?.code || '').toUpperCase()
    // 保留原始错误作为 fallback 文案，避免「未知 errno」时丢失可用信息
    const fallback =
      code === DOWNLOAD_DIR_PERM_CODE || !code
        ? formatDownloadPermissionMessage(resolved)
        : `下载目录不可写: ${resolved}（${code}: ${String(err?.message || '').slice(0, 200)}）`
    const e = new Error(describeDownloadDirFailure(code, resolved, fallback))
    // code 一律透出真实 errno（原来统统改写成 EACCES，调用方无法据此分流）
    ;(e as any).code = code || DOWNLOAD_DIR_PERM_CODE
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
