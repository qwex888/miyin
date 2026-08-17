export function usePlayer() {
  const current = useState<{ title: string; artist: string; url: string } | null>('player:current', () => null)
  const audio = useState<HTMLAudioElement | null>('player:audio', () => null)
  const playing = useState<boolean>('player:playing', () => false)

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
    el.src = track.url
    await el.play()
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

  function stop() {
    const el = audio.value
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    playing.value = false
    current.value = null
  }

  return { current, playing, play, pause, toggle, stop, audio }
}
