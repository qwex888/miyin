import { matchPlaylistTracks, type PlaylistTrackDraft } from '~~/server/services/playlistService'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import type { PlaylistMatchStreamEvent } from '#shared/playlistMatchProgress'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    tracks?: PlaylistTrackDraft[]
    scoreThreshold?: number
    concurrency?: number
    stream?: boolean | string
    allowManualBypass?: boolean
  }>(event)
  if (!body?.tracks?.length) {
    throw createError({ statusCode: 400, statusMessage: '请提供 tracks' })
  }

  const wantsStream = wantsSourceBatchStream(event, body.stream)

  if (!wantsStream) {
    const rows = await matchPlaylistTracks(body.tracks, {
      scoreThreshold: body.scoreThreshold,
      concurrency: body.concurrency,
      allowManualBypass: body.allowManualBypass,
    })
    return {
      total: rows.length,
      needConfirm: rows.filter((r) => r.needsConfirm).length,
      autoOk: rows.filter((r) => !r.needsConfirm && r.selected).length,
      rows,
    }
  }

  const stream = openNdjsonStream(event)
  const abortController = new AbortController()

  // 监听客户端连接断开/中断
  event.node.req.on('close', () => {
    if (!abortController.signal.aborted) {
      abortController.abort()
    }
  })

  const run = (async () => {
    try {
      await stream.send({ type: 'start', total: body.tracks!.length } as PlaylistMatchStreamEvent)

      let processedCount = 0
      const rows = await matchPlaylistTracks(body.tracks!, {
        scoreThreshold: body.scoreThreshold,
        concurrency: body.concurrency,
        allowManualBypass: body.allowManualBypass,
        signal: abortController.signal,
        onProgress: async ({ index, total, track, row }) => {
          const status = row.error
            ? 'failed'
            : row.method === 'manual'
              ? 'manual'
              : row.needsConfirm
                ? 'need_confirm'
                : 'matched'

          await stream.send({
            type: 'progress',
            index,
            total,
            track: {
              title: track.title,
              artist: track.artist,
              platform: track.platform,
            },
            status,
            score: row.score,
            error: row.error,
          } as PlaylistMatchStreamEvent)
        },
      })

      if (abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: processedCount,
          total: body.tracks!.length,
          message: '用户已取消匹配',
        } as PlaylistMatchStreamEvent)
      } else {
        await stream.send({
          type: 'done',
          total: rows.length,
          autoOk: rows.filter((r) => !r.needsConfirm && r.selected).length,
          needConfirm: rows.filter((r) => r.needsConfirm).length,
          rows,
        } as PlaylistMatchStreamEvent)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: 0,
          total: body.tracks!.length,
          message: '匹配已中断',
        } as PlaylistMatchStreamEvent)
      } else {
        await stream.send({
          type: 'error',
          message: err?.statusMessage || err?.message || String(err),
        } as PlaylistMatchStreamEvent)
      }
    } finally {
      await stream.close()
    }
  })()

  void run
  return stream.response
})
