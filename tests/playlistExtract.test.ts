import { describe, it, expect } from 'vitest'
import {
  extractNeteasePlaylistId,
  extractQqPlaylistId,
  extractKugouPlaylistId,
} from '../server/services/playlistService'

describe('extractNeteasePlaylistId', () => {
  it('parses classic playlist query', () => {
    expect(extractNeteasePlaylistId('https://music.163.com/#/playlist?id=123456789')).toBe('123456789')
    expect(extractNeteasePlaylistId('https://music.163.com/playlist?id=987654')).toBe('987654')
  })

  it('parses path style and bare id', () => {
    expect(extractNeteasePlaylistId('https://music.163.com/playlist/123456789')).toBe('123456789')
    expect(extractNeteasePlaylistId('123456789')).toBe('123456789')
  })

  it('parses mobile playlist url', () => {
    expect(
      extractNeteasePlaylistId(
        'https://music.163.com/m/playlist?id=359474091&creatorId=263582598',
      ),
    ).toBe('359474091')
  })
})

describe('extractQqPlaylistId', () => {
  it('parses desktop / mobile playlist paths', () => {
    expect(extractQqPlaylistId('https://y.qq.com/n/ryqq/playlist/8672609904')).toBe('8672609904')
    expect(extractQqPlaylistId('https://y.qq.com/n/ryqq_v2/playlist/8672609904')).toBe('8672609904')
    expect(extractQqPlaylistId('https://y.qq.com/n/yqq/playlist/8672609904.html')).toBe('8672609904')
    expect(extractQqPlaylistId('https://y.qq.com/n/ryqq/playsquare/8672609904')).toBe('8672609904')
  })

  it('parses share pages and query params', () => {
    expect(
      extractQqPlaylistId('https://i.y.qq.com/n2/m/share/details/taoge.html?id=8672609904&hosteuin=xxx'),
    ).toBe('8672609904')
    expect(extractQqPlaylistId('https://y.qq.com/n/m/share/details/taoge.html?id=8672609904')).toBe(
      '8672609904',
    )
    expect(extractQqPlaylistId('https://y.qq.com/playlist.html?id=8672609904')).toBe('8672609904')
    expect(extractQqPlaylistId('https://y.qq.com/?disstid=8672609904')).toBe('8672609904')
  })

  it('accepts bare numeric id', () => {
    expect(extractQqPlaylistId('8672609904')).toBe('8672609904')
  })
})

describe('extractKugouPlaylistId', () => {
  it('parses special single and mobile plist', () => {
    expect(extractKugouPlaylistId('https://www.kugou.com/yy/special/single/9746424.html')).toBe(
      '9746424',
    )
    expect(extractKugouPlaylistId('https://m.kugou.com/plist/list/9746424')).toBe('9746424')
    expect(extractKugouPlaylistId('https://www.kugou.com/songlist/?specialid=9746424')).toBe('9746424')
  })
})
