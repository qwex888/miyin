/**
 * 音源 id 的合法性校验。
 *
 * id 会直接拼进缓存路径（`<dataDir>/sources/<id>.js`），所以必须按**文件名**校验而不是
 * 按任意字符串：完整包 `manifest.json` 里的 `sources[].id` 来自外部文件，不校验时
 * `"../../../../Users/x/evil"` 会让 `writeFileSync` 写到数据目录之外（任意 .js 写入）。
 */

/** 仅字母数字与 `._-`，长度 1..64 */
const SAFE_SOURCE_ID = /^[A-Za-z0-9._-]{1,64}$/

export function isValidSourceId(id: string): boolean {
  if (!SAFE_SOURCE_ID.test(id)) return false
  // `.` / `..` 与任何含 `..` 的组合都可能改变路径层级
  return id !== '.' && id !== '..' && !id.includes('..')
}

/**
 * 校验并原样返回 id；不合法时抛 400。
 * 依赖全局 `createError`（h3 在请求上下文注入），与非请求上下文测试兼容。
 */
export function assertSafeSourceId(id: string): string {
  if (!isValidSourceId(id)) {
    throw createError({ statusCode: 400, statusMessage: `音源 ID 不合法：${id}` })
  }
  return id
}
