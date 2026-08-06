import { getSettings } from '~~/server/services/settingsService'

export default defineEventHandler(() => {
  return getSettings()
})
