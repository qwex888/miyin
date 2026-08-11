/**
 * 酷狗 KRC：base64 → XOR → inflate → 解析 language 翻译轨。
 * 算法与洛雪 / 公开实现一致（非 GPL 拷贝，按公开注释自行实现）。
 */
import { inflateSync } from 'node:zlib'

const ENC_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
])

function decodeName(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'))
  } catch {
    return s
  }
}

function msToLrcTag(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const frac = Math.floor(ms % 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

export function decodeKrcBase64(contentB64: string): { lyric: string; tlyric: string; rlyric: string } {
  const raw = Buffer.from(String(contentB64 || ''), 'base64')
  if (raw.length <= 4) return { lyric: '', tlyric: '', rlyric: '' }
  const buf = Buffer.from(raw.subarray(4))
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i]! ^ ENC_KEY[i % 16]!
  }
  let text = inflateSync(buf).toString('utf8').replace(/\r/g, '')
  text = text.replace(/^.*\[id:\$\w+\]\n/, '')

  let rlyricRows: string[][] | null = null
  let tlyricRows: string[][] | null = null
  const lang = text.match(/\[language:([\w=\\/+]+)\]/)
  if (lang?.[1]) {
    text = text.replace(/\[language:[\w=\\/+]+\]\n?/, '')
    try {
      const json = JSON.parse(Buffer.from(lang[1], 'base64').toString('utf8')) as {
        content?: Array<{ type: number; lyricContent: string[][] }>
      }
      for (const item of json.content || []) {
        if (item.type === 0) rlyricRows = item.lyricContent
        if (item.type === 1) tlyricRows = item.lyricContent
      }
    } catch {
      /* ignore bad language block */
    }
  }

  const lyricLines: string[] = []
  const tlyricLines: string[] = []
  const rlyricLines: string[] = []
  let i = 0
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(\d+),\d+\](.*)$/)
    if (!m) continue
    const tag = msToLrcTag(parseInt(m[1]!, 10))
    const body = (m[2] || '').replace(/<\d+,\d+,\d+>/g, '').replace(/<\d+,\d+>/g, '')
    lyricLines.push(`[${tag}]${decodeName(body)}`)
    if (tlyricRows?.[i]) tlyricLines.push(`[${tag}]${decodeName(tlyricRows[i]!.join(''))}`)
    if (rlyricRows?.[i]) rlyricLines.push(`[${tag}]${decodeName(rlyricRows[i]!.join(''))}`)
    i++
  }

  return {
    lyric: lyricLines.join('\n'),
    tlyric: tlyricLines.join('\n'),
    rlyric: rlyricLines.join('\n'),
  }
}
