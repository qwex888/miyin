// E2E-DOWNLOAD：真实下载闭环 —— 等待终态、校验文件存在、ffprobe 校验音频有效。
//
// 这是唯一会真正落盘的一组：用来抓「标记 completed 但文件是垃圾」这类
// 只有在端到端才会暴露的问题（历史上真出现过：ffprobe 报 Header missing，
// 旧逻辑仍判 ok，45MB 垃圾载荷被 rename 成 .mp3）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const meta = {
  tag: 'download',
  title: '下载闭环',
  order: 80,
  profiles: ['pc', 'mobile'],
}

const TERMINAL = ['completed', 'failed', 'cancelled']

export default async function run(t, ctx) {
  const { api, state, profile, downloadTimeoutMs } = ctx
  t.setPhase('/download')

  const queued = (state.enqueued || []).filter((x) => x.profile === profile)
  if (!queued.length) {
    t.skip('E2E-DL-01', '入队任务完成', '本端没有成功入队的任务（enqueue 用例未通过或被跳过）')
    return
  }
  const hasFfprobe = which('ffprobe')

  for (const [i, item] of queued.entries()) {
    const idx = String(i + 1).padStart(2, '0')

    await t.assert(
      `E2E-DL-0${idx}`,
      `任务到达终态：${item.title}`,
      async () => {
        const deadline = Date.now() + downloadTimeoutMs
        let last = null
        const trail = []
        while (Date.now() < deadline) {
          const r = await api.get('/api/downloads?tab=all&limit=300')
          last = (r.json?.items || []).find((x) => x.id === item.id)
          if (last) {
            const key = `${last.status}@${last.quality || '-'}`
            if (trail[trail.length - 1] !== key) trail.push(key)
            if (TERMINAL.includes(last.status)) break
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
        if (!last) throw new Error('队列里找不到该任务')
        if (!TERMINAL.includes(last.status)) {
          throw new Error(`超时仍在 ${last.status}（${trail.join(' → ')}）`)
        }
        if (last.status !== 'completed') {
          throw new Error(`status=${last.status} quality=${last.quality} error=${String(last.error || '').slice(0, 80)}`)
        }
        item.record = last
        return `${last.status} · ${last.quality || '-'} · ${trail.join(' → ')}`
      },
      { severity: 'P0' },
    )

    if (!item.record) continue

    await t.assert(
      `E2E-DL-${idx}1`,
      `文件落盘且体积合理：${item.title}`,
      async () => {
        const rec = item.record
        if (!rec.file_path) throw new Error('任务无 file_path')
        if (!fs.existsSync(rec.file_path)) throw new Error(`文件不存在：${rec.file_path}`)
        const st = fs.statSync(rec.file_path)
        if (st.size < 1024 * 1024) throw new Error(`体积过小 ${(st.size / 1024).toFixed(0)}KB，疑似空文件或试听片段`)
        return `${path.basename(rec.file_path)} ${(st.size / 1048576).toFixed(1)}MB`
      },
      { severity: 'P0' },
    )

    if (hasFfprobe) {
      await t.assert(
        `E2E-DL-${idx}2`,
        `音频可解码：${item.title}`,
        async () => {
          const p = item.record.file_path
          let json
          try {
            const out = execFileSync(
              'ffprobe',
              [
                '-v', 'error',
                '-select_streams', 'a:0',
                '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_raw_sample',
                '-show_entries', 'format=duration,bit_rate',
                '-of', 'json',
                p,
              ],
              { encoding: 'utf8', timeout: 20000 },
            )
            json = JSON.parse(out)
          } catch (e) {
            throw new Error(`ffprobe 无法解析（疑似非音频载荷）：${String(e.message).split('\n')[0].slice(0, 100)}`)
          }
          const s = json.streams?.[0] || {}
          const dur = Number(json.format?.duration || 0)
          const br = Math.round(Number(json.format?.bit_rate || 0) / 1000)
          // 这三个是判定「真音频」的核心：能解码出时长与码率
          if (!(dur > 30)) throw new Error(`时长异常 ${dur}s`)
          if (!(br > 100)) throw new Error(`码率异常 ${br}kbps`)
          if (!s.codec_name) throw new Error('无 codec_name')
          return `${dur.toFixed(1)}s ${s.codec_name} ${s.sample_rate}Hz ${s.channels}ch ${br}kbps`
        },
        { severity: 'P0' },
      )
    } else {
      t.skip(`E2E-DL-${idx}2`, `音频可解码：${item.title}`, '环境未安装 ffprobe')
    }
  }
}

function which(bin) {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
