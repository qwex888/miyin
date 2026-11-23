/**
 * 登录失败限流（按客户端地址）。
 *
 * 访问口令在飞牛/容器部署里典型是 6 位数字，而登录接口原本**没有任何失败计数** ——
 * 只要是局域网或内网穿透可达，一个脚本几小时就能穷举完。
 *
 * 两层策略：
 * 1. 指数退避：连续失败超过 3 次后，每次都要等 1s → 2s → 4s …（上限 60s）才能再试；
 * 2. 硬锁定：连续失败 10 次锁定 5 分钟。
 *
 * 状态只放内存：进程重启即清空，这在安全上可以接受（重启本身就打断爆破节奏），
 * 落库反而会给攻击者制造写放大。地址取自 socket（不走 `x-forwarded-for`），
 * 避免伪造头绕过。代价是反向代理后所有请求共用同一桶 —— 对单用户的 NAS 应用来说，
 * 宁可整体变慢 5 分钟，也不能留一条无限试错的路。
 */

/** 前 3 次失败不罚延迟，避免正常用户手滑两次就被挡在门外 */
const BACKOFF_AFTER = 3
const BACKOFF_BASE_MS = 1000
const MAX_BACKOFF_MS = 60_000
const LOCK_AFTER = 10
const LOCK_MS = 5 * 60_000
/** 空闲超过该时长的条目视为过期（成功登录会直接删除，这里只是兜底） */
const ENTRY_TTL_MS = 60 * 60_000
/** 条目上限：防止有人用海量伪造地址把内存撑爆 */
const MAX_ENTRIES = 2000

type Entry = {
  fails: number
  /** 下一次允许尝试的时间戳（退避） */
  nextAttemptAt: number
  /** 锁定的截止时间戳；0 表示未锁定 */
  lockedUntil: number
  updatedAt: number
}

const attempts = new Map<string, Entry>()

function sweep(now: number) {
  if (attempts.size <= MAX_ENTRIES) return
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil <= now && now - entry.updatedAt > ENTRY_TTL_MS) attempts.delete(key)
  }
  // 仍然超限：按插入顺序丢弃最旧的（Map 保序），保证内存有硬上界
  if (attempts.size > MAX_ENTRIES) {
    const overflow = attempts.size - MAX_ENTRIES
    let dropped = 0
    for (const key of attempts.keys()) {
      if (dropped >= overflow) break
      attempts.delete(key)
      dropped++
    }
  }
}

export type LoginGate =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; locked: boolean }

/** 当前是否允许尝试（不修改计数） */
export function checkLoginAllowed(ip: string, now = Date.now()): LoginGate {
  const entry = attempts.get(ip)
  if (!entry) return { allowed: true }

  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      locked: true,
    }
  }
  if (entry.nextAttemptAt > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.nextAttemptAt - now) / 1000)),
      locked: false,
    }
  }
  return { allowed: true }
}

/** 记一次失败并推进退避/锁定 */
export function recordLoginFailure(ip: string, now = Date.now()): void {
  const entry = attempts.get(ip) ?? { fails: 0, nextAttemptAt: 0, lockedUntil: 0, updatedAt: now }
  entry.fails += 1
  entry.updatedAt = now

  if (entry.fails >= LOCK_AFTER) {
    entry.lockedUntil = now + LOCK_MS
    entry.nextAttemptAt = entry.lockedUntil
  } else if (entry.fails > BACKOFF_AFTER) {
    const step = entry.fails - BACKOFF_AFTER - 1
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, step), MAX_BACKOFF_MS)
    entry.nextAttemptAt = now + delay
  }

  attempts.set(ip, entry)
  sweep(now)
}

/** 成功后清空该地址的失败记录 */
export function recordLoginSuccess(ip: string): void {
  attempts.delete(ip)
}

/** 测试 / 口令变更后重置全部限流状态 */
export function resetLoginThrottle(): void {
  attempts.clear()
}

/** 仅用于诊断：当前被限流/锁定的地址数量 */
export function loginThrottleSize(): number {
  return attempts.size
}
