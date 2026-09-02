<script setup lang="ts">
definePageMeta({ middleware: [], keepalive: false })

const token = ref('')
const showToken = ref(false)
const error = ref('')
const loading = ref(false)
const { login } = useAuth()
const { mode, cycle } = useTheme()
const toast = useToast()

const themeTitle = computed(() => {
  if (mode.value === 'light') return '浅色（点击切换）'
  if (mode.value === 'dark') return '深色（点击切换）'
  return '跟随系统（点击切换）'
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(token.value)
    toast.success('登录成功')
    await navigateTo('/')
  } catch (e: unknown) {
    const m = apiErrorMessage(e, '登录失败')
    error.value = m
    toast.error(m)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <button
      class="theme-fab icon-btn"
      type="button"
      :title="themeTitle"
      :aria-label="themeTitle"
      @click="cycle"
    >
      <svg v-if="mode === 'light'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg v-else-if="mode === 'dark'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
      </svg>
      <svg v-else class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    </button>
    <form class="card login-card" @submit.prevent="submit">
      <div class="brand-block">
        <BrandLogo :size="48" />
        <p class="muted">输入访问口令继续</p>
      </div>
      <label class="field">
        <span class="label">访问口令</span>
        <div class="token-wrap">
          <input
            v-model="token"
            class="input token-input"
            :type="showToken ? 'text' : 'password'"
            placeholder="Token"
            autocomplete="current-password"
          />
          <button
            class="token-toggle"
            type="button"
            :title="showToken ? '隐藏口令' : '显示口令'"
            :aria-label="showToken ? '隐藏口令' : '显示口令'"
            :aria-pressed="showToken"
            @click="showToken = !showToken"
          >
            <PasswordVisibilityIcon :visible="showToken" />
          </button>
        </div>
      </label>
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading || !token">
        {{ loading ? '登录中…' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at top, color-mix(in oklab, var(--accent) 12%, transparent), transparent 55%),
    var(--bg);
}
.login-card {
  width: min(400px, 100%);
  display: grid;
  gap: 14px;
  padding: 24px;
  box-shadow: var(--shadow);
}
.brand-block {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.brand-block .muted {
  margin: 0;
  font-size: 13px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.token-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.token-input {
  width: 100%;
  padding-right: 42px;
}
.token-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.token-toggle:hover {
  color: var(--text);
  background: hsl(var(--secondary));
}
.token-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.err {
  color: var(--danger);
  margin: 0;
  font-size: 13px;
}
.theme-fab {
  position: fixed;
  top: 16px;
  right: 16px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.icon-btn:hover {
  background: hsl(var(--secondary));
}
.ico {
  width: 16px;
  height: 16px;
}
</style>
