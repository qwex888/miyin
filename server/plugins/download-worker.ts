import { startDownloadWorker } from '../services/downloadQueue'

export default defineNitroPlugin(() => {
  startDownloadWorker()
})
