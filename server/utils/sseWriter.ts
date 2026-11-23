/**
 * SSE 写入器：给单向事件流加背压。
 *
 * `res.write()` 在客户端不读时返回 false 但**仍然接受数据**，Node 会一直往
 * `writableBuffer` 里堆。休眠的笔记本、后台标签页、半开的 NAT 连接都属此类；
 * 10 个卡住的连接配 5 并发，一小时就是几百 MB。
 *
 * 进度类事件允许丢帧（前端在 SSE 断线时本来就有轮询兜底，后续快照/进度会覆盖旧值），
 * 所以策略是「积压超阈值就丢，连续丢太多就断开」，而不是无限缓冲或阻塞 worker。
 */

export const SSE_MAX_BUFFERED_BYTES = 1024 * 1024
/** 连续丢帧达到该次数说明对端确实不读了，主动断开把内存还回来 */
export const SSE_MAX_CONSECUTIVE_DROPS = 500

export type SseSink = {
  writableLength: number
  writableEnded?: boolean
  write(chunk: string): unknown
}

export type SseWriterOptions = {
  maxBufferedBytes?: number
  maxConsecutiveDrops?: number
  /** 连续丢帧超限时调用（通常是 destroy 连接） */
  onOverflow?: () => void
}

export function createSseWriter(sink: SseSink, opts: SseWriterOptions = {}) {
  const maxBufferedBytes = opts.maxBufferedBytes ?? SSE_MAX_BUFFERED_BYTES
  const maxDrops = opts.maxConsecutiveDrops ?? SSE_MAX_CONSECUTIVE_DROPS
  let dropped = 0
  let closed = false

  function close() {
    closed = true
  }

  /** 写一帧；返回是否真的写入（false = 已丢弃/已关闭） */
  function write(chunk: string): boolean {
    if (closed || sink.writableEnded) return false
    if (sink.writableLength > maxBufferedBytes) {
      dropped++
      if (dropped > maxDrops) {
        close()
        opts.onOverflow?.()
      }
      return false
    }
    dropped = 0
    sink.write(chunk)
    return true
  }

  function send(eventName: string, data: unknown): boolean {
    return write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  return {
    write,
    send,
    close,
    get droppedFrames() {
      return dropped
    },
    get closed() {
      return closed
    },
  }
}
