export function usePlayer() {
  const current = useState<{ title: string; artist: string; url: string } | null>('player:current', () => null)
  const audio = useState<HTMLAudioElement | null>('player:audio', () => null)
  const playing = useState<boolean>('player:playing', () => false)
  const currentTime = useState<number>('player:currentTime', () => 0)
  const duration = useState<number>('player:duration', () => 0)
  const collapsed = useState<boolean>('player:collapsed', () => false)

  function syncDuration(el: HTMLAudioElement) {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      duration.value = el.duration
    }
  }

  function bindAudioEvents(el: HTMLAudioElement) {
    if ((el as HTMLAudioElement & { __miyinBound?: boolean }).__miyinBound) return
    ;(el as HTMLAudioElement & { __miyinBound?: boolean }).__miyinBound = true
    el.addEventListener('play', () => {
      playing.value = true
    })
    el.addEventListener('pause', () => {
      playing.value = false
    })
    el.addEventListener('ended', () => {
      playing.value = false
    })
    el.addEventListener('timeupdate', () => {
      currentTime.value = el.currentTime
    })
    el.addEventListener('durationchange', () => syncDuration(el))
    el.addEventListener('loadedmetadata', () => syncDuration(el))
  }

  function ensureAudio() {
    if (import.meta.server) return null
    if (!audio.value) {
      audio.value = new Audio()
    }
    bindAudioEvents(audio.value)
    return audio.value
  }

  async function play(track: { title: string; artist: string; url: string }) {
    const el = ensureAudio()
    if (!el) return
    current.value = track
    collapsed.value = false
    currentTime.value = 0
    duration.value = 0
    el.src = track.url
    await el.play()
    syncDuration(el)
  }

  function pause() {
    audio.value?.pause()
  }

  function toggle() {
    const el = audio.value
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  function seek(time: number) {
    const el = audio.value
    if (!el) return
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : time
    const next = Math.max(0, Math.min(time, max))
    el.currentTime = next
    currentTime.value = next
  }

  function stop() {
    const el = audio.value
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    playing.value = false
    current.value = null
    currentTime.value = 0
    duration.value = 0
  }

  return {
    current,
    playing,
    currentTime,
    duration,
    collapsed,
    play,
    pause,
    toggle,
    seek,
    stop,
    audio,
  }
}
