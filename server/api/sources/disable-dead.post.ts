import { disableDeadSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async () => {
  return disableDeadSources()
})
