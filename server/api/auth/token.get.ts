import { getAuthTokenStatus } from '~~/server/services/authTokenService'

export default defineEventHandler(() => getAuthTokenStatus())
