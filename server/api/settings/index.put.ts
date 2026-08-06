import { saveSettings } from '~~/server/services/settingsService'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return saveSettings(body || {})
})
