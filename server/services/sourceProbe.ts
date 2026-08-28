import {
  acquireSourceRejectionGuard,
  loadLxSource,
  settleSourceNetworkErrors,
  type LxSourceHandle,
} from './sourceRuntime'
import { withTimeout } from '../utils/sourceBatchTimeout'

/** 探针优先尝试的平台顺序 */
export const PROBE_PLATFORM_ORDER = ['wy', 'kw', 'kg', 'tx', 'mg'] as const

/** 各平台固定探针曲目（仅用于检测，不写入业务数据） */
export const PROBE_TRACKS: Record<
  string,
  { songmid: string; hash: string; name: string; singer: string }
> = {
  wy: { songmid: '421423806', hash: '421423806', name: '小半', singer: '陈粒' },
  kw: { songmid: '228908', hash: '228908', name: '测试', singer: '测试' },
  kg: {
    songmid: 'EEDBDCB8E3A9453390DBF897FEBB629',
    hash: 'EEDBDCB8E3A9453390DBF897FEBB629',
    name: '测试',
    singer: '测试',
  },
  tx: {
    songmid: '0039MnYb0qxYhV',
    hash: '0039MnYb0qxYhV',
    name: '晴天',
    singer: '周杰伦',
  },
  mg: { songmid: '60054701942', hash: '60054701942', name: '测试', singer: '测试' },
}

const PROBE_TIMEOUT_MS = Number(process.env.MIYIN_SOURCE_PROBE_TIMEOUT_MS || 12000)

export type SourceProbeResult = {
  platforms: string[]
  status: 'ok' | 'dead'
  lastError: string | null
}

export type ProbeTarget = {
  platform: string
  quality: string
  musicInfo: Record<string, any>
}

/** 将原始错误归类为用户可感知的说明 */
export function classifySourceError(
  raw: string,
  hints?: { updateAlerts?: string[] },
): string {
  const msg = (raw || '').trim()
  if (!msg) return '未知错误'

  const lower = msg.toLowerCase()
  const alerts = hints?.updateAlerts?.filter(Boolean) || []
  const versionAlert = alerts.find((a) => /版本|更新|upgrade|download|下载最新|请.*更新/i.test(a))

  if (/service suspended|has been suspended/i.test(msg)) {
    return 'API 服务已停服（Service Suspended）'
  }
  if (/enotfound|getaddrinfo|not found.*dns/i.test(lower)) {
    return 'API 域名无法解析（DNS 失败），请检查网络或脚本中的 API 地址'
  }
  if (/econnrefused|connection refused/i.test(lower)) {
    return '无法连接 API 服务端（连接被拒绝）'
  }
  if (/etimedout|request timeout|socket hang up|network error/i.test(lower)) {
    return 'API 请求超时或网络中断，远端服务无响应'
  }
  if (/key失效|鉴权失败|invalid.*key|api.?key|x-request-key/i.test(lower) || /key.*(无效|失效|为空)/i.test(msg)) {
    return 'API Key 无效或未配置，请在音源脚本中填写有效密钥'
  }
  if (/block ip|ip.*封|拒绝访问.*ip/i.test(lower)) {
    return 'API 拒绝访问（IP 被封禁）'
  }
  if (/too many requests|请求过速|请求过于频繁|\b429\b/.test(lower)) {
    return 'API 限流（请求过于频繁）'
  }
  if (/\b404\b|not found|接口不存在|404 not found/i.test(lower)) {
    const base = 'API 接口不存在（HTTP 404），脚本可能过旧或 API 地址已变更'
    return versionAlert ? `${base}；${versionAlert}` : base
  }
  if (/internal server error|\b500\b|服务端错误/i.test(lower)) {
    return 'API 服务端错误（HTTP 500）'
  }
  if (/param error|参数错误|source not match/i.test(lower)) {
    return 'API 参数错误或平台不匹配（探针曲目可能不受该源支持）'
  }
  if (/unknow error|unknown error|无法解析|unexpected token|<!doctype/i.test(lower)) {
    const base = 'API 返回异常（可能服务已停服、返回 HTML 或响应格式变更）'
    return versionAlert ? `${base}；${versionAlert}` : base
  }
  if (/未能获取播放地址|get music url failed|get url failed|取链.*失败/i.test(lower)) {
    return '取链失败，API 未返回有效播放地址'
  }
  if (/初始化超时|未完成初始化|未注册 musicurl|脚本过大|禁止 require|熔断/.test(msg)) {
    return msg
  }
  if (/超时/.test(msg)) {
    return '取链探针超时，远端 API 长时间无响应'
  }

  if (versionAlert && !/版本|更新/.test(msg)) {
    return `${msg}；${versionAlert}`
  }
  return msg
}

function pickQuality(platform: string, handle: LxSourceHandle): string | null {
  const qualities = handle.qualityMap[platform] || ['128k', '320k']
  if (qualities.includes('128k')) return '128k'
  if (qualities.includes('320k')) return '320k'
  return qualities[0] || null
}

/** 按平台优先级列出全部可探针目标 */
export function listProbeTargets(handle: LxSourceHandle): ProbeTarget[] {
  const out: ProbeTarget[] = []
  for (const platform of PROBE_PLATFORM_ORDER) {
    if (!handle.platforms.includes(platform)) continue
    const track = PROBE_TRACKS[platform]
    if (!track) continue
    const quality = pickQuality(platform, handle)
    if (!quality) continue
    out.push({
      platform,
      quality,
      musicInfo: { ...track, source: platform },
    })
  }
  return out
}

function formatProbeFailure(
  target: ProbeTarget,
  raw: string,
  updateAlerts?: string[],
): string {
  const detail = classifySourceError(raw, { updateAlerts })
  return `取链探针失败（${target.platform}/${target.quality}）：${detail}`
}

function formatCheckUpdateFailure(raw: string, updateAlerts?: string[]): string {
  return `更新检查失败：${classifySourceError(raw, { updateAlerts })}`
}

/** 对已加载音源执行试取链探针 */
export async function probeLoadedHandle(
  handle: LxSourceHandle,
  netErrs: Error[],
): Promise<SourceProbeResult> {
  const platforms = handle.platforms
  const updateAlerts = handle.updateAlerts

  if (netErrs.length) {
    return {
      platforms,
      status: 'dead',
      lastError: formatCheckUpdateFailure(netErrs[0]!.message, updateAlerts),
    }
  }

  const targets = listProbeTargets(handle)
  if (!targets.length) {
    return { platforms, status: 'ok', lastError: null }
  }

  const attemptErrors: string[] = []
  for (const target of targets) {
    try {
      await withTimeout(
        handle.getMusicUrl(target.platform, target.musicInfo, target.quality),
        PROBE_TIMEOUT_MS,
        '取链探针',
      )
      return { platforms, status: 'ok', lastError: null }
    } catch (err: any) {
      attemptErrors.push(formatProbeFailure(target, err?.message || String(err), updateAlerts))
    }
  }

  const primary = attemptErrors[0] || '取链探针失败'
  const extra =
    attemptErrors.length > 1
      ? `（已尝试 ${attemptErrors.length} 个平台）`
      : ''
  return {
    platforms,
    status: 'dead',
    lastError: `${primary}${extra}`,
  }
}

/** 加载本地脚本并执行完整检测（初始化 + 更新检查 + 试取链） */
export async function probeLocalScript(localPath: string): Promise<SourceProbeResult> {
  const guard = acquireSourceRejectionGuard()
  let handle: LxSourceHandle | null = null
  try {
    handle = await loadLxSource(localPath, { bypassCache: true })
    const netErrs = await settleSourceNetworkErrors(guard)
    return await probeLoadedHandle(handle, netErrs)
  } catch (err: any) {
    return {
      platforms: handle?.platforms || [],
      status: 'dead',
      lastError: classifySourceError(err?.message || String(err), {
        updateAlerts: handle?.updateAlerts,
      }),
    }
  } finally {
    handle?.dispose()
    guard.release()
  }
}
