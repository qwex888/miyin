import { describe, it, expect } from 'vitest'
import { copyFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeAudioMetadata, flacHasPictureBlock } from '../server/services/metadataService'

/**
 * 必须用不含 PICTURE 的样本；若样本本身已有封面，`-map 0 -c copy` 会保留旧封面，
 * 导致即使封面下载/转换失败也能「通过」。
 */
const COVERLESS_SAMPLE = '/Users/huangdongliang/code/miyin/downloads/毛不易 - 消愁.flac'
const COVER_URL =
  'https://p1.music.126.net/vmCcDvD1H04e9gm97xsCqg==/109951163350929740.jpg'

describe('flac cover embed', () => {
  it(
    'embeds jpeg picture block for coverless flac',
    async () => {
      if (!existsSync(COVERLESS_SAMPLE)) return
      expect(flacHasPictureBlock(COVERLESS_SAMPLE)).toBe(false)

      const dir = mkdtempSync(join(tmpdir(), 'miyin-flac-cover-'))
      const src = join(dir, 'sample.flac')
      try {
        copyFileSync(COVERLESS_SAMPLE, src)
        const r = await writeAudioMetadata(
          src,
          {
            title: '消愁',
            artist: '毛不易',
            album: '平凡的一天',
            platform: 'wy',
            quality: 'flac',
            external_id: '569200213',
          },
          {
            name: '消愁',
            singer: '毛不易',
            albumName: '平凡的一天',
            img: COVER_URL,
          },
          null,
        )
        expect(r.ok).toBe(true)
        expect(flacHasPictureBlock(src)).toBe(true)

        const buf = readFileSync(src)
        let off = 4
        let mime = ''
        let dataLen = 0
        while (off < buf.length) {
          const header = buf[off]!
          const isLast = (header & 0x80) !== 0
          const type = header & 0x7f
          const size = (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!
          if (type === 6) {
            let p = off + 4
            p += 4
            const mimeLen = buf.readUInt32BE(p)
            p += 4
            mime = buf.toString('ascii', p, p + mimeLen)
            p += mimeLen
            const descLen = buf.readUInt32BE(p)
            p += 4 + descLen + 16
            dataLen = buf.readUInt32BE(p)
          }
          off += 4 + size
          if (isLast) break
        }
        expect(mime).toBe('image/jpeg')
        expect(dataLen).toBeGreaterThan(10_000)
        expect(dataLen).toBeLessThan(1_500_000)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
