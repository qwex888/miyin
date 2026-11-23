import { downloadEvents, listTasks } from '~~/server/services/downloadQueue'
import { createSseWriter } from '~~/server/utils/sseWriter'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let cleaned = false

  // 背压处理在 utils/sseWriter 里（积压超 1MB 丢帧，连续丢 500 帧断开），
  // 这里只负责连接生命周期
  const sse = createSseWriter(res, {
    onOverflow: () => {
      cleanup()
      // destroy 而非 end：对端已经不读了，等它收 FIN 没有意义
      res.destroy()
    },
  })

  const onTask = (task: unknown) => sse.send('task', task)

  function cleanup() {
    if (cleaned) return
    cleaned = true
    sse.close()
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    downloadEvents.off('task', onTask)
  }

  sse.send('snapshot', { items: listTasks() })
  downloadEvents.on('task', onTask)

  heartbeat = setInterval(() => {
    sse.write(`: ping ${Date.now()}\n\n`)
  }, 15000)
  // 心跳定时器不应阻止进程退出
  heartbeat.unref?.()

  // close 与 error 都要收尾：只挂 close 时写失败（EPIPE）不会移除监听器，
  // 事件总线上会一直挂着一个指向已死响应的回调
  event.node.req.on('close', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)

  // 保持连接
  await new Promise<void>((resolve) => {
    event.node.req.on('close', () => resolve())
    res.on('close', () => resolve())
  })
})
