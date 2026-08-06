import { getSettings, NAME_TEMPLATE_VARS } from '~~/server/services/settingsService'
import { checkFfmpegAvailable } from '~~/server/services/metadataService'

export default defineEventHandler(async () => {
  const settings = getSettings()
  const ffmpeg = await checkFfmpegAvailable()
  return {
    ...settings,
    nameTemplateVars: NAME_TEMPLATE_VARS,
    ffmpegAvailable: ffmpeg,
  }
})
