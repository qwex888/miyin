import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appError, httpStatusText, isAsciiStatusText } from '../server/utils/appError'

type CreateErrorInput = {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}

declare global {
  var createError: (input: CreateErrorInput) => Error & {
    statusCode?: number
    statusMessage?: string
    data?: unknown
  }
}

globalThis.createError = (input: CreateErrorInput) => {
  const err = new Error(input.message || input.statusMessage || 'Error') as Error & {
    statusCode?: number
    statusMessage?: string
    data?: unknown
  }
  err.statusCode = input.statusCode
  err.statusMessage = input.statusMessage
  err.data = input.data
  return err
}

const NON_ASCII = /[^\u0009\u0020-\u007E]/

/**
 * h3 自 1.15 起用 `/[^\u0009\u0020-\u007E]/g` 清洗 statusMessage：
 * 中文会被**整段删空**，当前只打 warn，未来会真的生效。
 * 这三组用例锁住「新代码不得把中文塞进 statusMessage」这条纪律。
 */
describe('appError：中文提示走 message，statusMessage 保持 ASCII', () => {
  it('中文提示不会进入 statusMessage', () => {
    const err = appError({ statusCode: 401, message: '口令错误' })
    expect(err.statusMessage).toBe('Unauthorized')
    expect(err.message).toBe('口令错误')
    expect(NON_ASCII.test(err.statusMessage!)).toBe(false)
  })

  it('429 保留 data 业务字段（前端据此判断是否锁定）', () => {
    const err = appError({
      statusCode: 429,
      message: '尝试过于频繁，请 1 秒后再试',
      data: { code: 'LOGIN_THROTTLED', retryAfterSec: 1, locked: false },
    })
    expect(err.statusMessage).toBe('Too Many Requests')
    expect(err.message).toContain('尝试过于频繁')
    expect((err.data as { code: string }).code).toBe('LOGIN_THROTTLED')
  })

  it('传入非 ASCII 的 statusMessage 会被替换成标准 reason phrase', () => {
    const err = appError({ statusCode: 400, message: '参数不对', statusMessage: '参数不对' })
    expect(err.statusMessage).toBe('Bad Request')
  })

  it('未知状态码退化为 Error', () => {
    expect(httpStatusText(499)).toBe('Error')
    expect(httpStatusText(undefined)).toBe('Error')
  })

  it('覆盖常用状态码', () => {
    expect(httpStatusText(400)).toBe('Bad Request')
    expect(httpStatusText(401)).toBe('Unauthorized')
    expect(httpStatusText(404)).toBe('Not Found')
    expect(httpStatusText(409)).toBe('Conflict')
    expect(httpStatusText(500)).toBe('Internal Server Error')
    expect(httpStatusText(502)).toBe('Bad Gateway')
    expect(httpStatusText(504)).toBe('Gateway Timeout')
  })

  it('isAsciiStatusText 判定与 h3 的清洗规则一致', () => {
    expect(isAsciiStatusText('Bad Gateway')).toBe(true)
    expect(isAsciiStatusText('口令错误')).toBe(false)
    expect(isAsciiStatusText('音源 ID 不合法：a')).toBe(false)
  })
})

/**
 * 静态扫描：鉴权链路的错误提示必须走 appError。
 *
 * 没有做成「全仓扫描」，是因为存量还有 100+ 处待迁移（见
 * docs/plans/status-message-migration.md）；这里先锁住**每一条登录/鉴权失败路径**，
 * 因为它们是唯一会被高频触发的（每次输错口令都会打一条 h3 告警）。
 */
describe('鉴权链路不再产生非 ASCII statusMessage', () => {
  const AUTH_FILES = [
    'server/api/auth/login.post.ts',
    'server/api/auth/me.get.ts',
    'server/api/auth/token.put.ts',
    'server/middleware/auth.ts',
    'server/services/authTokenService.ts',
  ]

  const root = process.cwd()

  for (const file of AUTH_FILES) {
    it(`${file} 无中文 statusMessage`, () => {
      const src = readFileSync(join(root, file), 'utf8')
      const offenders: string[] = []
      const re = /statusMessage:\s*(['"`])([^'"`]*)\1/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (NON_ASCII.test(m[2])) offenders.push(m[2])
      }
      expect(offenders, `这些文案应改用 appError({ message })：${offenders.join(' / ')}`).toEqual([])
    })
  }
})

/** 防止有人「顺手」把 appError 改回 createError + 中文 statusMessage。 */
describe('appError 自身不调用带中文的 createError', () => {
  it('工具文件里没有非 ASCII 的 statusMessage 字面量', () => {
    const src = readFileSync(join(process.cwd(), 'server/utils/appError.ts'), 'utf8')
    const re = /statusMessage:\s*(['"`])([^'"`]*)\1/g
    const bad: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (NON_ASCII.test(m[2])) bad.push(m[2])
    }
    expect(bad).toEqual([])
  })
})

/** 兜底：全仓统计一次，暴露存量规模（数值变化时提醒去看迁移文档）。 */
describe('存量统计（仅供观察，不设硬门槛）', () => {
  it('打印仍在使用非 ASCII statusMessage 的文件数', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.ts')) files.push(p)
      }
    }
    walk(join(process.cwd(), 'server'))

    const hit = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const re = /statusMessage:\s*(['"`])([^'"`]*)\1/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (NON_ASCII.test(m[2])) hit.add(relative(process.cwd(), f))
      }
    }
    // 迁移收敛后会下降；断言只是「别悄悄又涨回去」的软提醒
    expect(hit.size).toBeLessThan(40)
  })
})
