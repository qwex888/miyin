import { matchPlaylistTracks, type PlaylistTrackDraft } from '~~/server/services/playlistService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    tracks?: PlaylistTrackDraft[]
    scoreThreshold?: number
  }>(event)

  if (!body?.tracks?.length) {
    throw createError({ statusCode: 400, statusMessage: '请提供 tracks' })
  }

  const rows = await matchPlaylistTracks(body.tracks, { scoreThreshold: body.scoreThreshold })
  return {
    total: rows.length,
    needConfirm: rows.filter((r) => r.needsConfirm).length,
    autoOk: rows.filter((r) => !r.needsConfirm && r.selected).length,
    rows,
  }
})
