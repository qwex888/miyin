import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  parseFfprobeAudioInfo,
  isUsableAudioInfo,
  probeAudioContent,
} from '../server/utils/audioPreview'
import { correctedQualityFromProbe } from '#shared/quality'

/** 真实 `ffprobe -select_streams a:0 -of default=noprint_wrappers=1` 的输出（《旅行》原样） */
const REAL_FLAC_16BIT_6CH = `codec_name=flac
sample_rate=44100
channels=6
bits_per_raw_sample=16
duration=266.853719
`

describe('parseFfprobeAudioInfo', () => {
  it('解析真实输出（16bit / 44.1kHz / 6声道）', () => {
    const info = parseFfprobeAudioInfo(REAL_FLAC_16BIT_6CH)
    expect(info.codec).toBe('flac')
    expect(info.sampleRate).toBe(44100)
    expect(info.channels).toBe(6)
    expect(info.bitsPerRawSample).toBe(16)
    expect(info.durationSec).toBeCloseTo(266.853719, 3)
  })

  it('真 24bit / 96kHz 立体声（应与 16bit 区分开）', () => {
    const info = parseFfprobeAudioInfo(
      'codec_name=flac\nsample_rate=96000\nchannels=2\nbits_per_raw_sample=24\nduration=200\n',
    )
    expect(info.bitsPerRawSample).toBe(24)
    expect(info.sampleRate).toBe(96000)
    expect(info.channels).toBe(2)
  })

  it('缺 bits_per_raw_sample（如 mp3）→ 该字段为 null，不影响其余字段', () => {
    const info = parseFfprobeAudioInfo('codec_name=mp3\nsample_rate=44100\nchannels=2\nduration=180\n')
    expect(info.bitsPerRawSample).toBeNull()
    expect(info.codec).toBe('mp3')
    expect(info.durationSec).toBe(180)
  })

  it('N/A 视为未知，不产生 NaN', () => {
    const info = parseFfprobeAudioInfo(
      'codec_name=flac\nbits_per_raw_sample=N/A\nchannels=N/A\nduration=N/A\n',
    )
    expect(info.bitsPerRawSample).toBeNull()
    expect(info.channels).toBeNull()
    expect(info.durationSec).toBeNull()
    expect(info.codec).toBe('flac')
  })

  it('空输出 / 无等号噪声 → 全字段 null，不抛错', () => {
    expect(parseFfprobeAudioInfo('')).toEqual({
      durationSec: null,
      codec: null,
      sampleRate: null,
      bitsPerRawSample: null,
      channels: null,
    })
    const noisy = parseFfprobeAudioInfo('ffprobe version 6.0\nsome noise\n=orphan\n')
    expect(noisy.codec).toBeNull()
    expect(noisy.durationSec).toBeNull()
  })

  it('值里含等号也能正确切分（只按第一个 = 拆）', () => {
    const info = parseFfprobeAudioInfo('codec_name=flac\nduration=1=2\n')
    expect(info.codec).toBe('flac')
    expect(info.durationSec).toBeNull() // "1=2" 不是合法数字 → null
  })

  it('多流混入（未加 -select_streams）时后出现的会覆盖前者 —— 这正是必须限定 a:0 的原因', () => {
    // 封面图 mjpeg 流在后：若无 select_streams，位深会被图片的 8bit 覆盖
    const polluted = parseFfprobeAudioInfo(
      'codec_name=flac\nbits_per_raw_sample=16\ncodec_name=mjpeg\nbits_per_raw_sample=8\n',
    )
    expect(polluted.codec).toBe('mjpeg')
    expect(polluted.bitsPerRawSample).toBe(8)
  })
})

describe('correctedQualityFromProbe（L3：只修正记录档位）', () => {
  it('声称 flac24bit 但实测 16bit → 修正为 flac（ynx 的真实情况）', () => {
    expect(correctedQualityFromProbe('flac24bit', { bitsPerRawSample: 16 })).toBe('flac')
  })

  it('实测确实是 24bit → 保持 flac24bit', () => {
    expect(correctedQualityFromProbe('flac24bit', { bitsPerRawSample: 24 })).toBe('flac24bit')
    expect(correctedQualityFromProbe('flac24bit', { bitsPerRawSample: 32 })).toBe('flac24bit')
  })

  it('位深未知（null）→ 不修正，不凭空降级', () => {
    expect(correctedQualityFromProbe('flac24bit', { bitsPerRawSample: null })).toBe('flac24bit')
  })

  it('探测失败（info 为 null）→ 不修正', () => {
    expect(correctedQualityFromProbe('flac24bit', null)).toBe('flac24bit')
    expect(correctedQualityFromProbe('flac24bit', undefined)).toBe('flac24bit')
  })

  it('非 flac24bit 的档位一律不动（不超出证据做推断）', () => {
    expect(correctedQualityFromProbe('flac', { bitsPerRawSample: 16 })).toBe('flac')
    expect(correctedQualityFromProbe('320k', { bitsPerRawSample: 16 })).toBe('320k')
    expect(correctedQualityFromProbe('128k', { bitsPerRawSample: null })).toBe('128k')
  })

  it('声称档位缺失时不修正', () => {
    expect(correctedQualityFromProbe(null, { bitsPerRawSample: 16 })).toBeNull()
    expect(correctedQualityFromProbe('', { bitsPerRawSample: 16 })).toBe('')
    expect(correctedQualityFromProbe(undefined, { bitsPerRawSample: 16 })).toBeUndefined()
  })

  it('修正只降一级到 flac，绝不会降到有损档位（文件本身是真无损）', () => {
    for (const bits of [8, 12, 16, 20, 23]) {
      expect(correctedQualityFromProbe('flac24bit', { bitsPerRawSample: bits })).toBe('flac')
    }
  })
})

/**
 * 实测样本：上游返回加密/损坏载荷时，ffprobe 会报 `Header missing`，
 * 但仍打出 codec_name（其余参数全为 0/N/A）。这类载荷曾被判 ok 并落盘成功。
 */
const CORRUPT_PAYLOAD = `codec_name=mp3
sample_rate=0
channels=0
bits_per_raw_sample=N/A
duration=N/A
`

describe('isUsableAudioInfo（有无可用音频参数）', () => {
  it('正常无损：可判定为音频', () => {
    expect(isUsableAudioInfo(parseFfprobeAudioInfo(REAL_FLAC_16BIT_6CH))).toBe(true)
  })

  it('只有 codec_name、其余全空 ⇒ 不可判定为音频（加密/损坏载荷）', () => {
    const info = parseFfprobeAudioInfo(CORRUPT_PAYLOAD)
    expect(info.codec).toBe('mp3')
    expect(info.durationSec).toBeNull()
    // num() 只接受 >0，0 与 N/A 一律归 null
    expect(info.sampleRate).toBeNull()
    expect(info.channels).toBeNull()
    expect(isUsableAudioInfo(info)).toBe(false)
  })

  it('只有时长、没有采样率（流式容器）也算可用', () => {
    expect(isUsableAudioInfo({ durationSec: 210 })).toBe(true)
  })

  it('只有采样率、没有时长也算可用', () => {
    expect(isUsableAudioInfo({ sampleRate: 44100 })).toBe(true)
  })

  it('完全空 ⇒ 不可用', () => {
    expect(isUsableAudioInfo({})).toBe(false)
  })
})

/**
 * 真实 ffprobe 回归：随机二进制会被 ffprobe 低置信度误判成 mp3
 * （`codec_name=mp3` 但 sample_rate/channels=0、duration=N/A）。
 * 修复前这种载荷被判 `ok`，越过了下载队列的内容硬校验，垃圾文件落盘成 completed。
 */
describe('probeAudioContent（真实 ffprobe）', () => {
  it('不可解码的二进制载荷 ⇒ not-audio（而不是 ok）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miyin-probe-'))
    const file = join(dir, 'junk.mp3')
    try {
      writeFileSync(file, randomBytes(300_000))
      const r = await probeAudioContent(file)
      if (r.kind === 'unavailable') {
        // 未安装 ffprobe 时无法判定，用例不成立（CI 若无 ffmpeg 也不会误报失败）
        console.warn('[skip] 环境中没有可用的 ffprobe')
        return
      }
      expect(r.kind).toBe('not-audio')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
