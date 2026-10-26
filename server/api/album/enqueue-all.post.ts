import {
  matchAndEnqueuePlaylist,
  type PlaylistTrackDraft,
  type PlaylistDraft,
} from '~~/server/services/playlistService'
import {
  getAlbumTracksPage,
  ALBUM_TRACKS_PAGE_SIZE,
  ALBUM_TRACKS_MAX_ITEMS,
} from '~~/server/services/platformAlbum'
import { openNdjsonStream, wantsSourceBatchStream } from '~~/server/utils/ndjsonStream'
import type { PlaylistMatchStreamEvent } from '#shared/playlistMatchProgress'

type Body = {
  platform?: string
  albumId?: string
  albumTitle?: string
  albumArtist?: string
  albumCover?: string
  quality?: string
  downloadLyric?: boolean
  lyricMode?: 'external' | 'embedded'
  albumDownloadToFolder?: boolean
  albumFolderTemplate?: string
  stream?: boolean | string
}

/** 结果明细上限：2637 集全量回传会让弹窗渲染 2637 行 DOM，只回「非全成功」的条目 */
const RESULTS_KEEP_MAX = 500

function toDraftTrack(track: {
  externalId: string
  title: string
  artist: string
  album?: string
  duration?: number
  platform: string
  musicInfo?: Record<string, any>
}): PlaylistTrackDraft {
  return {
    externalId: track.externalId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    platform: track.platform,
    musicInfo: track.musicInfo,
    matchMethod: 'id',
  } satisfies PlaylistTrackDraft
}

/**
 * 整专下载（Issue #40）。
 *
 * 详情页只加载前几页，但「下载整专」必须覆盖全部集数 —— 由服务端按游标自己翻页，
 * 前端只消费 NDJSON 进度，避免让用户点 27 次「加载更多」。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const platform = body?.platform || 'wy'
  const albumId = String(body?.albumId || '').trim()
  if (!albumId) throw createError({ statusCode: 400, statusMessage: '缺少 albumId' })

  const hint = {
    title: body?.albumTitle || undefined,
    artist: body?.albumArtist || undefined,
    cover: body?.albumCover || undefined,
  }
  const opts = {
    quality: body?.quality,
    downloadLyric: body?.downloadLyric,
    lyricMode: body?.lyricMode,
    albumDownloadToFolder: body?.albumDownloadToFolder,
    albumFolderTemplate: body?.albumFolderTemplate,
    albumArtist: body?.albumArtist,
  }

  /** 逐页拉全；返回曲目 + 专辑标题 */
  const collectAll = async (onPage?: (loaded: number, total?: number, title?: string) => void | Promise<void>) => {
    const tracks: PlaylistTrackDraft[] = []
    let cursor = 0
    let albumTitle = hint.title || ''
    let total: number | undefined
    // 页数上限按平台页大小推导（20000 集硬顶），不依赖上游 total
    const pageSize = ALBUM_TRACKS_PAGE_SIZE[platform as keyof typeof ALBUM_TRACKS_PAGE_SIZE] || 0
    const maxPages = pageSize > 0 ? Math.ceil(ALBUM_TRACKS_MAX_ITEMS / pageSize) + 1 : 1
    for (let i = 0; i < maxPages; i++) {
      const page = await getAlbumTracksPage(platform, albumId, cursor, hint)
      albumTitle = hint.title || page.album.title || albumTitle
      total = page.total
      for (const t of page.tracks) tracks.push(toDraftTrack(t))
      cursor = page.nextCursor
      await onPage?.(tracks.length, total, albumTitle)
      if (!page.hasMore || !page.tracks.length) break
    }
    return { tracks, albumTitle, total }
  }

  const wantsStream = wantsSourceBatchStream(event, body?.stream)

  if (!wantsStream) {
    const { tracks, albumTitle } = await collectAll()
    if (!tracks.length) throw createError({ statusCode: 502, statusMessage: '专辑曲目为空' })
    const draft: PlaylistDraft = {
      platform,
      title: albumTitle || `专辑 ${albumId}`,
      url: `album://${platform}/${albumId}`,
      tracks,
    }
    return await matchAndEnqueuePlaylist(draft, opts)
  }

  const stream = openNdjsonStream(event)
  const abortController = new AbortController()
  event.node.req.on('close', () => {
    if (!abortController.signal.aborted) abortController.abort()
  })

  const run = (async () => {
    try {
      await stream.send({ type: 'start', total: 0, stage: 'parsing' } as unknown as PlaylistMatchStreamEvent)

      const { tracks, albumTitle } = await collectAll(async (loaded, knownTotal, title) => {
        await stream.send({
          type: 'parse_progress',
          index: loaded,
          total: knownTotal || 0,
          title: title || '',
        } as unknown as PlaylistMatchStreamEvent)
      })

      if (!tracks.length) throw new Error('专辑曲目为空')

      const draft: PlaylistDraft = {
        platform,
        title: albumTitle || `专辑 ${albumId}`,
        url: `album://${platform}/${albumId}`,
        tracks,
      }

      await stream.send({
        type: 'start',
        total: tracks.length,
        stage: 'matching',
      } as unknown as PlaylistMatchStreamEvent)

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
          total: res.total,
          message: '用户已取消入队',
        })
      } else {
        // 成功条目数量可达数千，全量回传只会把弹窗撑爆：只回「需要用户知道」的条目
        const notable = res.results
          .filter((r) => !r.ok || r.skipped || r.replaced)
          .slice(0, RESULTS_KEEP_MAX)
        await stream.send({
          type: 'done',
          batchId: res.batchId,
          playlistTitle: res.playlistTitle,
          total: res.total,
          enqueued: res.enqueued,
          results: notable,
        })
      }
    } catch (err: unknown) {
      const e = err as { name?: string; statusMessage?: string; message?: string }
      if (e?.name === 'AbortError' || abortController.signal.aborted) {
        await stream.send({
          type: 'cancelled',
          processed: 0,
          total: 0,
          message: '操作已中断',
        })
      } else {
        await stream.send({
          type: 'error',
          message: e?.statusMessage || e?.message || String(err),
        })
      }
    } finally {
      await stream.close()
    }
  })()

  void run
  return stream.response
})
