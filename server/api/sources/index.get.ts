import { listSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(() => {
  return { items: listSources() }
})
