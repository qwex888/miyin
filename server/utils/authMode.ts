/** AUTH_TOKEN 为空（或仅空白）时进入开放模式：免登录、API 免鉴权 */
export function isAuthRequired(authToken: unknown): boolean {
  return String(authToken ?? '').trim().length > 0
}
