import { request as httpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'

const OPEN_API_SOCKET = '/var/run/trim_open_gateway_apiscope.socket'

export type FnOsOpenApiResult<T = unknown> = {
  reqId?: string
  code: number
  msg: string
  data: T
}

function getToken() {
  return String(process.env.TRIM_API_TOKEN || '').trim()
}

export function canCallFnOsOpenApi() {
  return Boolean(getToken())
}

/**
 * 经飞牛开放 API Unix Socket 调用 trimapp。
 * 文档：https://developer.fnnas.com/api/calling/
 */
export function callFnOsOpenApi<T = unknown>(req: string, data: Record<string, unknown> = {}): Promise<FnOsOpenApiResult<T>> {
  const token = getToken()
  if (!token) {
    return Promise.reject(createError({ statusCode: 503, statusMessage: '缺少 TRIM_API_TOKEN，无法调用飞牛开放 API' }))
  }

  const appName = String(process.env.TRIM_APPNAME || 'miyin').trim() || 'miyin'
  const body = JSON.stringify({
    reqId: randomUUID(),
    req,
    appName,
    data,
  })

  return new Promise((resolve, reject) => {
    const reqHttp = httpRequest(
      {
        socketPath: OPEN_API_SOCKET,
        path: '/api/v1/trimapp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          try {
            const json = JSON.parse(raw) as FnOsOpenApiResult<T>
            resolve(json)
          } catch {
            reject(
              createError({
                statusCode: 502,
                statusMessage: `飞牛开放 API 响应无法解析: ${raw.slice(0, 200)}`,
              }),
            )
          }
        })
      },
    )
    reqHttp.on('error', (err) => {
      reject(
        createError({
          statusCode: 502,
          statusMessage: `飞牛开放 API 调用失败: ${err?.message || err}`,
        }),
      )
    })
    reqHttp.setTimeout(15000, () => {
      reqHttp.destroy()
      reject(createError({ statusCode: 504, statusMessage: '飞牛开放 API 超时' }))
    })
    reqHttp.write(body)
    reqHttp.end()
  })
}

export async function getSharedAccessibleFolders(): Promise<string[]> {
  const res = await callFnOsOpenApi<{ paths?: string[] }>('trim.file.getSharedAccessibleFolders', {})
  if (res.code !== 0) {
    throw createError({
      statusCode: 502,
      statusMessage: res.msg || `查询共享授权目录失败 (code=${res.code})`,
    })
  }
  return Array.isArray(res.data?.paths) ? res.data.paths.filter((p) => typeof p === 'string' && p) : []
}
