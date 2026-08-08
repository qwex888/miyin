import { getFnOsDirAuthStatus } from '~~/server/services/fnosDirAuth'

export default defineEventHandler(async () => {
  return getFnOsDirAuthStatus()
})
