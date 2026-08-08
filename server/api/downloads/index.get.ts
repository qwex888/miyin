import { listTasks } from '~~/server/services/downloadQueue'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : undefined
  return { items: listTasks(status) }
})
