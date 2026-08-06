import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createSessionToken(secret: string) {
  const exp = Date.now() + SESSION_TTL_MS
  const payload = Buffer.from(JSON.stringify({ exp, n: randomUUID() })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token: string | undefined, secret: string): { exp: number } | null {
  if (!token || !secret) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp: number }
    if (!data.exp || Date.now() > data.exp) return null
    return data
  } catch {
    return null
  }
}

export function safeEqualString(a: string, b: string) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
