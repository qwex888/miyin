/**
 * 统一错误构造：把「人话」放 message，把「HTTP reason phrase」放 statusMessage。
 *
 * 为什么必须这么分：
 * h3 1.15 起对 statusMessage 做白名单清洗 `/[^\u0009\u0020-\u007E]/g` ——
 * **任何非 ASCII 字符（含全部中文）都会被删掉**。当前版本只在
 * `sanitizeStatusMessage(original) !== original` 时打一条 warn，
 * 但警告文案明确写了「In the future, statusMessage will be sanitized by default」。
 *
 * 也就是说：现在把中文塞进 statusMessage 能显示，等 h3 升级后同一份代码
 * 会静默返回空的 statusMessage，前端所有错误提示集体消失。
 * 所以新代码一律用 `appError()`，不要再直接调 createError 传中文提示。
 *
 * 迁移存量见 `docs/plans/status-message-migration.md`。
 */

/** HTTP 标准 reason phrase（RFC 9110）。statusMessage 只能用这里的值。 */
const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

/** 取 statusCode 对应的 ASCII reason phrase；未知码退化为 'Error'。 */
export function httpStatusText(statusCode?: number): string {
  if (!statusCode) return 'Error'
  return HTTP_STATUS_TEXT[statusCode] || 'Error'
}

/** 文本是否只能安全放进 statusMessage（纯 ASCII 可打印字符）。 */
export function isAsciiStatusText(value: string): boolean {
  return !/[^\u0009\u0020-\u007E]/.test(value)
}

type AppErrorInput = {
  statusCode: number
  /** 面向用户的中文提示，最终进入响应体 message 字段 */
  message: string
  data?: Record<string, unknown>
  /** 需要覆盖默认 reason phrase 时才传，且必须是 ASCII */
  statusMessage?: string
}

/**
 * 构造一个「提示可读、协议合规」的错误。
 *
 * @example
 * throw appError({ statusCode: 401, message: '口令错误' })
 * // → statusMessage: 'Unauthorized', message: '口令错误'
 */
export function appError(input: AppErrorInput) {
  const statusMessage = input.statusMessage ?? httpStatusText(input.statusCode)
  return createError({
    statusCode: input.statusCode,
    statusMessage: isAsciiStatusText(statusMessage) ? statusMessage : httpStatusText(input.statusCode),
    message: input.message,
    ...(input.data ? { data: input.data } : {}),
  })
}
