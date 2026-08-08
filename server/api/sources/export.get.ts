import { buildSourcesExportZip } from '~~/server/services/sourceBundle'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const idsRaw = query.ids
  const ids =
    typeof idsRaw === 'string' && idsRaw.trim()
      ? idsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined

  const result = buildSourcesExportZip({ ids })
  if (!result.exported) {
    throw createError({ statusCode: 400, statusMessage: '没有可导出的音源（本地脚本均缺失）' })
  }

  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="${result.filename}"`)
  setHeader(event, 'X-Miyin-Exported', String(result.exported))
  setHeader(event, 'X-Miyin-Skipped', String(result.skipped))
  return result.buffer
})
