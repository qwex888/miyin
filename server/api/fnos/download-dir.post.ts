import { z } from 'zod'
import { saveSettings } from '~~/server/services/settingsService'
import { getFnOsDirAuthStatus, persistCustomDownloadDir } from '~~/server/services/fnosDirAuth'
import { isFnOsRuntime } from '~~/server/utils/fnosEnv'
import { isDownloadPermissionError } from '~~/server/utils/downloadDir'

const BodySchema = z.object({
  downloadDir: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event))
  if (!isFnOsRuntime()) {
    throw createError({ statusCode: 400, statusMessage: '仅飞牛环境支持写入下载目录配置' })
  }

  const written = persistCustomDownloadDir(body.downloadDir)
  let settingsSaved = true
  let settingsError: string | undefined
  try {
    saveSettings({ downloadDir: written.customDownloadDir })
  } catch (e: any) {
    settingsSaved = false
    settingsError = e?.statusMessage || e?.message || '设置保存失败'
    // ACL 刚授予时当前进程可能仍不可写；env 已写入，重启后由 cmd/main 生效
    if (!isDownloadPermissionError(e) && e?.statusCode !== 400) {
      throw e
    }
  }

  const auth = await getFnOsDirAuthStatus()

  return {
    ok: true,
    downloadDir: written.customDownloadDir,
    downloadMode: written.downloadMode,
    restartRequired: true,
    settingsSaved,
    settingsError,
    auth,
  }
})
