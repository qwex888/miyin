import { parsePlaylist } from '~~/server/services/playlistService'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import type { PlaylistMatchStreamEvent } from '#shared/playlistMatchProgress'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string; stream?: boolean | string }>(event)
  const url = (body?.url || '').trim()
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: '请输入歌单链接' })
  }

  const wantsStream = wantsSourceBatchStream(event, body?.stream)
  if (!wantsStream) {
    return await parsePlaylist(url)
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
      await stream.send({ type: 'start', total: 0, stage: 'parsing' } as unknown as PlaylistMatchStreamEvent)
      const draft = await parsePlaylist(url, {
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

      if (abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: 0,
          total: draft.tracks.length,
          message: '用户已取消解析',
        } as unknown as PlaylistMatchStreamEvent)
      } else {
        await stream.send({
          type: 'done',
          platform: draft.platform,
          title: draft.title,
          url: draft.url,
          tracks: draft.tracks,
        } as unknown as PlaylistMatchStreamEvent)
      }
    } catch (err: unknown) {
      const e = err as { name?: string; statusMessage?: string; message?: string }
      if (e?.name === 'AbortError' || abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: 0,
          total: 0,
          message: '解析已中断',
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
