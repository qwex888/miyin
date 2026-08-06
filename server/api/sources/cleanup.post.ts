import { cleanupDeadSources } from '~~/server/services/sourceRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ dryRun?: boolean }>(event)
  return cleanupDeadSources(!!body?.dryRun)
})
