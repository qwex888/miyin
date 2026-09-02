import { changeAuthToken } from '~~/server/services/authTokenService'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ currentToken?: string; newToken?: string; confirmToken?: string }>(event)
  const currentToken = String(body?.currentToken ?? '')
  const newToken = String(body?.newToken ?? '')
  const confirmToken = body?.confirmToken

  if (confirmToken !== undefined && String(confirmToken) !== newToken) {
    throw createError({ statusCode: 400, statusMessage: '两次输入的新口令不一致' })
  }

  return changeAuthToken({ currentToken, newToken })
})
