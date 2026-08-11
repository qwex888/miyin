import { describe, expect, it } from 'vitest'
import { encryptQrc } from 'qrc-decoder'
import {
  mergeBilingualLyrics,
  parseLrcLines,
  splitKuwoLrcList,
} from '../server/services/lyricService'
import { applyNameTemplate } from '../server/services/downloadQueue'
import {
  decryptTxFieldToLrc,
  extractTxLyricContent,
  qrcContentToLrc,
  tryDecryptTxQrcField,
} from '../server/utils/txQrc'
import { decodeKrcBase64 } from '../server/utils/krcDecode'
import { inflateSync } from 'node:zlib'

describe('bilingual lyrics', () => {
  it('merges same timestamp into two lines', () => {
    const merged = mergeBilingualLyrics(
      '[00:01.00]こんにちは\n[00:02.00]世界',
      '[00:01.00]konnichiwa\n[00:02.00]sekai',
    )
    expect(merged).toContain('[00:01.00]こんにちは')
    expect(merged).toContain('[00:01.00]konnichiwa')
    expect(parseLrcLines(merged).filter((l) => l.time === '00:01.00')).toHaveLength(2)
  })

  it('returns original when no translation', () => {
    expect(mergeBilingualLyrics('[00:01.00]hello', '')).toBe('[00:01.00]hello')
  })
})

describe('kuwo bilingual split', () => {
  it('treats duplicate timestamps as translation', () => {
    const { lyric, tlyric } = splitKuwoLrcList([
      { time: '0.00', lineLyric: 'こんにちは' },
      { time: '0.00', lineLyric: 'hello' },
      { time: '1.50', lineLyric: '世界' },
      { time: '1.50', lineLyric: 'world' },
    ])
    expect(lyric).toContain('こんにちは')
    expect(lyric).toContain('世界')
    expect(tlyric).toContain('hello')
    expect(tlyric).toContain('world')
  })
})

describe('tx qrc helpers', () => {
  it('roundtrips encrypt → decrypt → lrc', () => {
    const inner = '[0,1000]你(0,200)好(200,200)\n[1000,800]世(0,200)界(200,200)'
    const xml = `<?xml version="1.0"?><LyricInfo><LyricContent="${inner}"/></LyricInfo>`
    const hex = encryptQrc(xml)
    const plain = tryDecryptTxQrcField(hex)
    expect(plain).toBeTruthy()
    const content = extractTxLyricContent(plain!)
    const lrc = qrcContentToLrc(content)
    expect(lrc).toContain('[00:00.000]你好')
    expect(lrc).toContain('[00:01.000]世界')
    expect(decryptTxFieldToLrc(hex)).toContain('你好')
  })

  it('passes through plain lrc', () => {
    expect(decryptTxFieldToLrc('[00:01.00]hi')).toContain('[00:01.00]hi')
  })
})

describe('krc decode', () => {
  it('decodes xor+inflate payload with language translation', () => {
    const ENC_KEY = Buffer.from([
      0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
    ])
    const lang = Buffer.from(
      JSON.stringify({
        content: [{ type: 1, lyricContent: [['hello'], ['world']] }],
      }),
    ).toString('base64')
    const body =
      `[id:$000]\n[language:${lang}]\n` + `[0,1000]<0,0,0>你好\n[1000,800]<0,0,0>世界\n`
    const inflated = Buffer.from(body, 'utf8')
    // reverse of decode: we need compressed then xor then prepend 4 bytes
    // build by: zlib compress, xor, prepend
    const { deflateSync } = require('node:zlib') as typeof import('node:zlib')
    const compressed = deflateSync(inflated)
    const xored = Buffer.from(compressed)
    for (let i = 0; i < xored.length; i++) xored[i] = xored[i]! ^ ENC_KEY[i % 16]!
    const payload = Buffer.concat([Buffer.from([0, 0, 0, 0]), xored]).toString('base64')
    const { lyric, tlyric } = decodeKrcBase64(payload)
    expect(lyric).toContain('你好')
    expect(lyric).toContain('世界')
    expect(tlyric).toContain('hello')
    expect(tlyric).toContain('world')
    void inflateSync
  })
})

describe('name template', () => {
  it('replaces all known vars', () => {
    const name = applyNameTemplate('{artist} - {title} [{platform}/{quality}] #{track}', {
      artist: 'A',
      title: 'B',
      platform: 'wy',
      quality: '320k',
      track: 3,
    })
    expect(name).toBe('A - B [wy_320k] #3')
  })
})
