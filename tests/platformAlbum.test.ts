import { describe, it, expect } from 'vitest'
import {
  mapWySearchAlbums,
  mapWyAlbumDetail,
  mapTxSearchAlbums,
  mapTxAlbumDetail,
  mapKwSearchAlbums,
  mapKwAlbumDetail,
  mapKgSearchAlbums,
  mapKgAlbumDetail,
  mapKgAlbumSong,
} from '../server/services/platformAlbum'

describe('mapWySearchAlbums', () => {
  it('maps cloudsearch album list when artist is a single object', () => {
    const items = mapWySearchAlbums([
      {
        id: 18915,
        name: '范特西',
        artist: { name: '周杰伦', id: 6452 },
        artists: [{ name: '周杰伦' }],
        size: 10,
        picUrl: 'http://pic',
      },
    ])
    expect(items[0]).toMatchObject({
      id: 'wy:18915',
      externalId: '18915',
      title: '范特西',
      artist: '周杰伦',
      trackCount: 10,
      platform: 'wy',
    })
    expect(items[0]!.artist).not.toContain('object')
  })

  it('does not stringify artist object when artists array is missing', () => {
    const items = mapWySearchAlbums([
      { id: 1, name: '测试', artist: { name: '歌手A' }, size: 3 },
    ])
    expect(items[0]!.artist).toBe('歌手A')
  })
})

describe('mapWyAlbumDetail', () => {
  it('maps album with songs and musicInfo', () => {
    const detail = mapWyAlbumDetail({
      album: { id: 123, name: '范特西', artist: { name: '周杰伦' }, size: 1, picUrl: 'http://pic' },
      songs: [{ id: 456, name: '爱在西元前', ar: [{ name: '周杰伦' }], dt: 234000, al: { name: '范特西' } }],
    })
    expect(detail.album.title).toBe('范特西')
    expect(detail.album.artist).toBe('周杰伦')
    expect(detail.tracks).toHaveLength(1)
    expect(detail.tracks[0]!.musicInfo.source).toBe('wy')
    expect(detail.tracks[0]!.musicInfo.songmid).toBe('456')
    expect(detail.tracks[0]!.duration).toBe(234)
  })
})

describe('mapTxSearchAlbums', () => {
  it('maps qq album search camelCase fields from t=8', () => {
    const items = mapTxSearchAlbums([
      {
        albumMID: 'ABC123',
        albumName: '叶惠美',
        singerName: '周杰伦',
        song_count: 11,
        albumPic: 'http://cover.jpg',
      },
    ])
    expect(items[0]).toMatchObject({
      id: 'tx:ABC123',
      externalId: 'ABC123',
      title: '叶惠美',
      artist: '周杰伦',
      trackCount: 11,
    })
    expect(items[0]!.cover).toContain('cover.jpg')
  })
})

describe('mapTxAlbumDetail', () => {
  it('maps qq album detail with singername string and musicInfo', () => {
    const detail = mapTxAlbumDetail(
      {
        data: {
          mid: 'ABC123',
          name: '叶惠美',
          singername: '周杰伦',
          total_song_num: 1,
          list: [
            {
              songmid: 'SONG001',
              songname: '以父之名',
              singer: [{ name: '周杰伦' }],
              interval: 340,
              songid: 999,
              strMediaMid: 'media001',
            },
          ],
        },
      },
      'ABC123',
    )
    expect(detail.album.artist).toBe('周杰伦')
    expect(detail.tracks[0]!.musicInfo.source).toBe('tx')
    expect(detail.tracks[0]!.musicInfo.songmid).toBe('SONG001')
    expect(detail.tracks[0]!.musicInfo.songid).toBe(999)
  })
})

describe('mapKwSearchAlbums', () => {
  it('maps kuwo album search', () => {
    const items = mapKwSearchAlbums([
      { ALBUMID: '888', NAME: '测试专辑', ARTIST: '歌手', SONGNUM: '5', web_albumpic_short: 'pic.jpg' },
    ])
    expect(items[0]).toMatchObject({
      id: 'kw:888',
      externalId: '888',
      title: '测试专辑',
      trackCount: 5,
    })
  })
})

describe('mapKwAlbumDetail', () => {
  it('maps kuwo album songs', () => {
    const detail = mapKwAlbumDetail(
      {
        album: { albumid: '888', name: '测试专辑', artist: '歌手' },
        musiclist: [{ MUSICRID: 'MUSIC_123', NAME: '曲目1', ARTIST: '歌手', DURATION: '200' }],
      },
      '888',
    )
    expect(detail.tracks[0]!.musicInfo.source).toBe('kw')
    expect(detail.tracks[0]!.externalId).toBe('123')
  })
})

describe('mapKgSearchAlbums', () => {
  it('maps mobilecdn v3 album search lowercase fields', () => {
    const items = mapKgSearchAlbums([
      {
        albumid: 958706,
        albumname: '范特西',
        singername: '周杰伦',
        songcount: 10,
        imgurl: 'http://img/{size}/a.jpg',
      },
    ])
    expect(items[0]).toMatchObject({
      id: 'kg:958706',
      title: '范特西',
      artist: '周杰伦',
      trackCount: 10,
    })
    expect(items[0]!.cover).toBe('http://img/240/a.jpg')
  })
})

describe('mapKgAlbumSong', () => {
  it('parses filename "歌手 - 歌名"', () => {
    const t = mapKgAlbumSong({ hash: 'abc', filename: '周杰伦 - 爱在西元前', duration: 234 }, '范特西')
    expect(t.title).toBe('爱在西元前')
    expect(t.artist).toBe('周杰伦')
    expect(t.musicInfo.hash).toBe('abc')
  })
})

describe('mapKgAlbumDetail', () => {
  it('maps mobilecdn album/song where data.info is the song list', () => {
    const detail = mapKgAlbumDetail(
      {
        data: {
          total: 1,
          info: [{ hash: 'hash001', filename: '歌手 - 曲目', duration: 180 }],
        },
      },
      '777',
      { title: 'KG专辑', artist: '歌手' },
    )
    expect(detail.album.title).toBe('KG专辑')
    expect(detail.album.trackCount).toBe(1)
    expect(detail.tracks[0]!.musicInfo.source).toBe('kg')
    expect(detail.tracks[0]!.musicInfo.hash).toBe('hash001')
    expect(detail.tracks[0]!.title).toBe('曲目')
  })
})
