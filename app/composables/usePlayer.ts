export function usePlayer() {
  const current = useState<{ title: string; artist: string; url: string } | null>('player:current', () => null)
  const audio = useState<HTMLAudioElement | null>('player:audio', () => null)

  function ensureAudio() {
    if (import.meta.server) return null
    if (!audio.value) {
      audio.value = new Audio()
    }
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

  return { current, play, pause, toggle, audio }
}
