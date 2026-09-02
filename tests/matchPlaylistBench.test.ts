import { describe, it, expect } from 'vitest'
import { matchPlaylistTracks, type PlaylistTrackDraft } from '../server/services/playlistService'

describe('600+ playlist match benchmark', () => {
  it('processes 600 tracks with concurrency and measures throughput', async () => {
    // 构造 600 首歌曲（其中有带 musicInfo 的直接命中，以及模拟处理）
    const tracks: PlaylistTrackDraft[] = Array.from({ length: 600 }, (_, i) => ({
      platform: 'wy',
      externalId: `track-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      musicInfo: { id: `track-${i}` },
    }))

    const start = Date.now()
    let progressCalls = 0
    const rows = await matchPlaylistTracks(tracks, {
      concurrency: 8,
      allowManualBypass: true,
      onProgress: () => {
        progressCalls++
      },
    })

    const durationMs = Date.now() - start
    console.log(`[Bench] 600 tracks matched in ${durationMs}ms, progressCalls=${progressCalls}`)

    expect(rows.length).toBe(600)
    expect(progressCalls).toBe(600)
    expect(durationMs).toBeLessThan(5000)
  })
})
