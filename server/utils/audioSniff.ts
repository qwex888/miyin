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

/** 内容自证为「非音频文本」的具体类型 */
export type TextualPayloadKind = 'html' | 'xml' | 'json' | 'text'

/**
 * 判定「内容自证不是音频」：明确的文本载荷（HTML 错误页 / XML / JSON / 纯文本）。
 *
 * 为什么需要它而不是直接用 `sniffAudioExt`：魔数嗅探是**正向白名单**，认不出的格式
 * 一律返回 null，无法区分「这是网页」和「这是我不认识的冷门音频格式」。
 * 而 ffprobe 在本项目是可选依赖（见 `packaging/fnos/miyin/cmd/install_init`），
 * 没装 ffmpeg 的机器拿不到外部证据 —— 此时若把「都认不出」当成「不是音频」，
 * 用户会连正常音频都下不到。
 *
 * 所以这里做**反向自证**：只判定「确定不是音频」的情况，判不出来就返回 null
 * （把决定权交回上层，即放行），绝不扩大拒绝面。
 *
 * 判据（三条同时满足才算文本，避免误杀 AC3/DTS 这类以控制字节开头的音频）：
 *   1. 前 512 字节内没有 NUL —— 音频压缩数据几乎必然出现 NUL；
 *   2. 去掉 BOM 与空白后首字节是可打印 ASCII —— 网页/JSON/纯文本都以 ASCII 开头；
 *   3. 全文控制字符占比 ≤ 2% —— 允许 UTF-8 中文（高位字节不计为控制字符）。
 */
export function sniffTextualPayload(filePath: string): TextualPayloadKind | null {
  if (!existsSync(filePath)) return null
  // 已被魔数认出的音频不参与文本判定（防御性：正常流程里调用方只在 !sniffed 时才进来）
  if (sniffAudioExt(filePath)) return null
  const size = 512
  const buf = Buffer.alloc(size)
  let n = 0
  try {
    const fd = openSync(filePath, 'r')
    try {
      n = readSync(fd, buf, 0, size, 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
  if (n < 4) return null

  const slice = buf.subarray(0, n)
  // 1. 含 NUL 的载荷不会出现在 HTML/JSON/纯文本里
  if (slice.includes(0)) return null

  const raw = slice.toString('latin1')
  const head = raw.replace(/^\u00EF\u00BB\u00BF/, '').replace(/^\s+/, '').toLowerCase()
  if (!head) return null

  // 2. 首字节必须是可打印 ASCII
  const first = head.charCodeAt(0)
  if (first < 0x20 || first > 0x7e) return null

  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
  if (head.startsWith('<?xml')) return 'xml'
  if (head.startsWith('{') || head.startsWith('[')) return 'json'

  // 3. 控制字符占比
  let control = 0
  for (let i = 0; i < n; i++) {
    const b = slice[i]!
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) control++
  }
  if (control / n > 0.02) return null

  return first === 0x3c ? 'html' : 'text'
}

/** 声明为无损的档位 */
const LOSSLESS_CLAIMS = new Set(['flac', 'flac24bit'])

/**
 * 「声称无损、实际有损」判定。
 *
 * **只认 mp3**：m4a 容器里可能是 ALAC（无损），ogg 可能是无损，都无法从魔数区分，
 * 判了会有误杀。mp3 是唯一能确定是"冒充"的情况 —— 也正是实际遇到的那种
 * （某音源声称 flac24bit，实测 321kbps，内容为 mp3）。
 */
export function isLosslessClaimMismatch(
  claimed: string | null | undefined,
  sniffedExt: string | null,
): boolean {
  if (!claimed || !sniffedExt) return false
  if (!LOSSLESS_CLAIMS.has(claimed)) return false
  return sniffedExt === 'mp3'
}
