import {
  parsePlaylist,
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
  type PlaylistDraft,
} from '~~/server/services/playlistService'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import type { PlaylistMatchStreamEvent } from '#shared/playlistMatchProgress'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    url?: string
    title?: string
    platform?: string
    tracks?: PlaylistTrackDraft[]
    quality?: string
    downloadLyric?: boolean
    lyricMode?: 'external' | 'embedded'
    stream?: boolean | string
    concurrency?: number
  }>(event)

  const opts = {
    quality: body?.quality,
    downloadLyric: body?.downloadLyric,
    lyricMode: body?.lyricMode,
    concurrency: body?.concurrency,
  }

  const wantsStream = wantsSourceBatchStream(event, body?.stream)

  if (!wantsStream) {
    // 已解析的选中曲目：直接入队，不再重新抓取歌单
    if (body?.tracks?.length) {
      return await matchAndEnqueuePlaylist(
        {
          platform: body.platform || body.tracks[0]?.platform || 'wy',
          title: body.title || '选中曲目',
          url: body.url || '',
          tracks: body.tracks,
        },
        opts,
      )
    }

    const draft = await parsePlaylist(body?.url || '')
    return await matchAndEnqueuePlaylist(draft, opts)
  }

  const stream = openNdjsonStream(event)
  const abortController = new AbortController()

  event.node.req.on('close', () => {
    if (!abortController.signal.aborted) {
      abortController.abort()
    }
  })

  const run = (async () => {
    try {
      let draft: PlaylistDraft
      if (body?.tracks?.length) {
        draft = {
          platform: body.platform || body.tracks[0]?.platform || 'wy',
          title: body.title || '选中曲目',
          url: body.url || '',
          tracks: body.tracks,
        }
      } else {
        await stream.send({ type: 'start', total: 0, stage: 'parsing' } as unknown as PlaylistMatchStreamEvent)
        draft = await parsePlaylist(body?.url || '', {
          signal: abortController.signal,
          onProgress: async (p) => {
            await stream.send({
              type: 'parse_progress',
              index: p.index,
              total: p.total,
              title: p.title,
            } as unknown as PlaylistMatchStreamEvent)
          },
        })
      }

      await stream.send({ type: 'start', total: draft.tracks.length, stage: 'matching' } as unknown as PlaylistMatchStreamEvent)

      const res = await matchAndEnqueuePlaylist(draft, {
        ...opts,
        signal: abortController.signal,
        onProgress: async (p) => {
          await stream.send({
            type: 'progress',
            stage: p.stage,
            index: p.index,
            total: p.total,
            title: p.title,
            ok: p.ok,
            error: p.error,
          } as unknown as PlaylistMatchStreamEvent)
        },
      })

      if (abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: res.enqueued,
          total: draft.tracks.length,
          message: '用户已取消入队',
        } as unknown as PlaylistMatchStreamEvent)
      } else {
        await stream.send({
          type: 'done',
          batchId: res.batchId,
          playlistTitle: res.playlistTitle,
          total: res.total,
          enqueued: res.enqueued,
          results: res.results,
        } as unknown as PlaylistMatchStreamEvent)
      }
    } catch (err: unknown) {
      const e = err as { name?: string; statusMessage?: string; message?: string }
      if (e?.name === 'AbortError' || abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: 0,
          total: 0,
          message: '操作已中断',
        } as unknown as PlaylistMatchStreamEvent)
      } else {
        await stream.send({
          type: 'error',
          message: e?.statusMessage || e?.message || String(err),
        } as unknown as PlaylistMatchStreamEvent)
      }
    } finally {
      await stream.close()
    }
  })()

  void run
  return stream.response
})
