import { describe, it, expect } from 'vitest'
import { copyFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeAudioMetadata, flacHasPictureBlock } from '../server/services/metadataService'

describe('flac cover embed', () => {
  it(
    'embeds jpeg picture block for flac',
    async () => {
      const sample = '/Users/huangdongliang/code/miyin/downloads/邓垚 - 诀别书.flac'
      if (!existsSync(sample)) return
      const dir = mkdtempSync(join(tmpdir(), 'miyin-flac-cover-'))
      const src = join(dir, 'sample.flac')
      try {
        copyFileSync(sample, src)
        const r = await writeAudioMetadata(
          src,
          {
            title: '诀别书',
            artist: '邓垚',
            album: '诀别书',
            platform: 'wy',
            quality: 'flac',
            external_id: '2038191895',
          },
          {
            name: '诀别书',
            singer: '邓垚',
            albumName: '诀别书',
            img: 'http://p2.music.126.net/wztA5smxFjIfv98u7-IrQQ==/109951168933355255.jpg',
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
