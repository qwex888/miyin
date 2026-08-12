/**
 * tx QRC 密文 → 行级 LRC（剥逐字时间标签）。
 * 解密依赖 MIT 包 qrc-decoder（非标准 3DES + inflate）。
 */
import { decryptQrc } from 'qrc-decoder'

const WORD_TIME = /\(\d+,\d+\)/g
const LINE_QRC = /^\[(\d+),\d+\](.*)$/
const LINE_LRC = /^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/

function msToLrcTag(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00.000'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const frac = Math.floor(ms % 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

/** 从解密后的 XML / 纯文本中取出 LyricContent */
export function extractTxLyricContent(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const attr = s.match(/LyricContent="([\s\S]*?)"\s*\/>/)
  if (attr?.[1]) return attr[1].replace(/\\n/g, '\n')
  const cdata = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  if (cdata?.[1]) return cdata[1].trim()
  return s
}

/** QRC 行 `[ms,dur]字(0,n)…` → 标准 LRC；已是 LRC 则原样返回 */
export function qrcContentToLrc(content: string): string {
  const text = String(content || '').replace(/\r/g, '').trim()
  if (!text) return ''
  const lines = text.split('\n')
  const out: string[] = []
  let sawQrc = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('[offset') || line.startsWith('[ti:') || line.startsWith('[ar:') || line.startsWith('[al:')) {
      out.push(line)
      continue
    }
    const qm = LINE_QRC.exec(line)
    if (qm) {
      sawQrc = true
      const tag = msToLrcTag(parseInt(qm[1]!, 10))
      const words = (qm[2] || '').replace(WORD_TIME, '')
      out.push(`[${tag}]${words}`)
      continue
    }
    if (LINE_LRC.test(line)) {
      out.push(line)
      continue
    }
  }
  if (!out.length && !sawQrc) return text
  return out.join('\n')
}

/**
 * 尝试将接口字段解成明文（hex QRC / 已是明文 / base64→hex）。
 * 失败返回 null（占位短密文、非 QRC 等）。
 */
export function tryDecryptTxQrcField(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (s.startsWith('<?xml') || s.includes('LyricContent=') || LINE_QRC.test(s.split('\n')[0] || '') || LINE_LRC.test(s)) {
    return s
  }
  const tryHex = (hex: string) => {
    const h = hex.replace(/\s+/g, '')
    if (h.length < 32 || h.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) return null
    try {
      return decryptQrc(h)
    } catch {
      return null
    }
  }
  const direct = tryHex(s)
  if (direct) return direct
  try {
    const buf = Buffer.from(s, 'base64')
    if (buf.length >= 16) {
      const fromB64 = tryHex(buf.toString('hex'))
      if (fromB64) return fromB64
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 解密并转成行级 LRC；失败返回空串 */
export function decryptTxFieldToLrc(raw: unknown): string {
  const plain = tryDecryptTxQrcField(raw)
  if (!plain) return ''
  return qrcContentToLrc(extractTxLyricContent(plain))
}
