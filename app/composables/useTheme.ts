const STORAGE_KEY = 'miyin-theme'

export type ThemeMode = 'light' | 'dark' | 'system'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveDark(mode: ThemeMode) {
  if (mode === 'system') return systemPrefersDark()
  return mode === 'dark'
}

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

/**
 * 主题：默认跟随系统；手动切换后写入 localStorage。
 * 图标按钮在 light / dark / system 间循环。
 */
export function useTheme() {
  const mode = useState<ThemeMode>('theme:mode', () => 'system')
  const isDark = useState('theme:isDark', () => false)

  function apply(next: ThemeMode) {
    mode.value = next
    const dark = import.meta.client ? resolveDark(next) : next === 'dark'
    isDark.value = dark
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
    }
  }

  function init() {
    if (!import.meta.client) return
    apply(readStored())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (mode.value === 'system') apply('system')
    }
    mq.addEventListener('change', onChange)
  }

  /** light → dark → system → light */
  function cycle() {
    const order: ThemeMode[] = ['light', 'dark', 'system']
    const i = order.indexOf(mode.value)
    apply(order[(i + 1) % order.length]!)
  }

  function toggleLightDark() {
    const dark = resolveDark(mode.value)
    apply(dark ? 'light' : 'dark')
  }

  return { mode, isDark, apply, init, cycle, toggleLightDark }
}
