import { getTaskStats } from '~~/server/services/downloadQueue'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const playlistUrl = typeof query.playlist_url === 'string' && query.playlist_url.trim() ? query.playlist_url.trim() : undefined
  const batchId = typeof query.batch_id === 'string' && query.batch_id.trim() ? query.batch_id.trim() : undefined

  return getTaskStats({ playlistUrl, batchId })
})
