import { openSync, readSync, closeSync, existsSync } from 'node:fs'

/**
 * 根据文件魔数推断音频扩展名（不含点）。
 * 用于纠正「URL/音质声称 flac、实际却是 mp3」等情况。
 */
export function sniffAudioExt(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const buf = Buffer.alloc(16)
  let n = 0
  try {
    const fd = openSync(filePath, 'r')
    try {
      n = readSync(fd, buf, 0, 16, 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
  if (n < 4) return null

  // fLaC
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return 'flac'

  // ID3v2 → mp3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3'

  // MPEG frame sync
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return 'mp3'

  // Ogg
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg'

  // RIFF....WAVE
  if (n >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav'
  }

  // ISO BMFF (m4a/mp4): ....ftyp
  if (n >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'm4a'

  // APE tag / Monkey's Audio often starts with MAC
  if (buf.toString('ascii', 0, 3) === 'MAC') return 'ape'

  return null
}
