import { existsSync } from 'node:fs'
import { isFnOsRuntime } from './fnosEnv'

/** 安装/部署形态，用于更新提示等按环境文案 */
export type DeployMode = 'fnos' | 'docker' | 'other'

/**
 * 检测当前部署形态。
 * 优先级：飞牛 FPK（TRIM_*）> Docker（MIYIN_RUNTIME / /.dockerenv）> 其它。
 */
export function getDeployMode(): DeployMode {
  if (isFnOsRuntime()) return 'fnos'
  const runtime = String(process.env.MIYIN_RUNTIME || '')
    .trim()
    .toLowerCase()
  if (runtime === 'docker' || runtime === 'container') return 'docker'
  if (existsSync('/.dockerenv')) return 'docker'
  return 'other'
}
