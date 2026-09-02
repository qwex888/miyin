export default defineEventHandler(() => {
  const mem = process.memoryUsage()
  return {
    ok: true,
    service: 'miyin',
    ts: Date.now(),
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / (1024 * 1024)) * 100) / 100,
      externalMb: Math.round((mem.external / (1024 * 1024)) * 100) / 100,
      arrayBuffersMb: Math.round(((mem.arrayBuffers || 0) / (1024 * 1024)) * 100) / 100,
    },
  }
})
