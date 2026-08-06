import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sniffAudioExt } from '../server/utils/audioSniff'

describe('sniffAudioExt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'miyin-sniff-'))

  function write(name: string, bytes: number[]) {
    const p = join(dir, name)
    writeFileSync(p, Buffer.from(bytes))
    return p
  }

  it('detects flac / mp3 / m4a magic', () => {
    expect(sniffAudioExt(write('a.flac', [0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0]))).toBe('flac')
    expect(sniffAudioExt(write('a.mp3', [0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]))).toBe('mp3')
    expect(sniffAudioExt(write('b.mp3', [0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]))).toBe('mp3')
    // size(4) + ftyp
    expect(
      sniffAudioExt(write('a.m4a', [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])),
    ).toBe('m4a')
  })

  it('returns null for unknown', () => {
    const p = write('x.bin', [0x00, 0x01, 0x02, 0x03])
    expect(sniffAudioExt(p)).toBeNull()
    unlinkSync(p)
  })
})
