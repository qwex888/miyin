import { startDownloadWorker } from '../services/downloadQueue'
import { getSettings } from '../services/settingsService'
import { ensureDownloadDirWritable } from '../utils/downloadDir'

export default defineNitroPlugin(() => {
  try {
    ensureDownloadDirWritable(getSettings().downloadDir)
  } catch (err: any) {
    console.error(
      '[miyin] 下载目录当前不可写，创建下载任务将失败：',
      err?.message || err,
    )
  }
  startDownloadWorker()
})
