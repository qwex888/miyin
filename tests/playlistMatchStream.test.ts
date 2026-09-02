import { describe, it, expect } from 'vitest'
import {
  matchPlaylistTracks,
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
} from '../server/services/playlistService'

describe('matchPlaylistTracks concurrent and abort features', () => {
  it('processes manual tracks immediately with allowManualBypass and supports onProgress callback', async () => {
    const tracks: PlaylistTrackDraft[] = [
      {
        platform: 'wy',
        externalId: '101',
        title: '晴天',
        artist: '周杰伦',
        musicInfo: { id: '101' },
      },
      {
        platform: 'wy',
        externalId: '102',
        title: '七里香',
        artist: '周杰伦',
        musicInfo: { id: '102' },
      },
      {
        platform: 'wy',
        externalId: '103',
        title: '青花瓷',
        artist: '周杰伦',
        musicInfo: { id: '103' },
      },
    ]

    const progressLogs: Array<{ index: number; total: number; title: string; score: number }> = []
    const rows = await matchPlaylistTracks(tracks, {
      concurrency: 2,
      allowManualBypass: true,
      onProgress: ({ index, total, track, row }) => {
        progressLogs.push({ index, total, title: track.title, score: row.score })
      },
    })

    expect(rows.length).toBe(3)
    expect(progressLogs.length).toBe(3)
    expect(rows[0]?.selected?.title).toBe('晴天')
    expect(rows[1]?.selected?.title).toBe('七里香')
    expect(rows[2]?.selected?.title).toBe('青花瓷')
  })

  it('supports abort signal to interrupt queue execution early in matchPlaylistTracks', async () => {
    const abortController = new AbortController()

    // 构造大量需要处理的任务
    const tracks: PlaylistTrackDraft[] = Array.from({ length: 50 }, (_, i) => ({
      platform: 'wy',
      externalId: `ext-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      musicInfo: { id: `ext-${i}` },
    }))

    let count = 0
    const matchPromise = matchPlaylistTracks(tracks, {
      concurrency: 1,
      allowManualBypass: true,
      signal: abortController.signal,
      onProgress: () => {
        count++
        if (count >= 5) {
          abortController.abort()
        }
      },
    })

    const rows = await matchPromise
    // 应该在中途被中断，返回已完成的行，且不会执行完 50 个
    expect(rows.length).toBeLessThan(50)
    expect(rows.length).toBeGreaterThanOrEqual(5)
  })

  it('supports matchAndEnqueuePlaylist with concurrency, progress events and abort signal', async () => {
    const abortController = new AbortController()
    const tracks: PlaylistTrackDraft[] = Array.from({ length: 20 }, (_, i) => ({
      platform: 'wy',
      externalId: `tid-${i}`,
      title: `Track ${i}`,
      artist: `Singer ${i}`,
      musicInfo: { songmid: `tid-${i}`, name: `Track ${i}`, singer: `Singer ${i}` },
    }))

    const progressEvents: Array<{ index: number; total: number; title: string }> = []
    const res = await matchAndEnqueuePlaylist(
      {
        platform: 'wy',
        title: '测试歌单',
        url: 'https://music.163.com/playlist?id=12345',
        tracks: tracks.slice(0, 5),
      },
      {
        concurrency: 2,
        onProgress: (p) => {
          progressEvents.push({ index: p.index, total: p.total, title: p.title })
        },
      },
    )

    expect(res.enqueued).toBe(5)
    expect(progressEvents.length).toBe(5)
    expect(res.results.length).toBe(5)
    expect(res.results.every((r) => r.ok)).toBe(true)

    // 测试中断
    let abortCount = 0
    await expect(
      matchAndEnqueuePlaylist(
        {
          platform: 'wy',
          title: '测试中断歌单',
          url: 'https://music.163.com/playlist?id=99999',
          tracks,
        },
        {
          concurrency: 1,
          signal: abortController.signal,
          onProgress: () => {
            abortCount++
            if (abortCount >= 3) {
              abortController.abort()
            }
          },
        },
      ),
    ).rejects.toThrow()
  })
})
