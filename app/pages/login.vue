<script setup lang="ts">
definePageMeta({ middleware: [] })

const token = ref('')
const error = ref('')
const loading = ref(false)
const { login } = useAuth()
const config = useRuntimeConfig()

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(token.value)
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="card login-card" @submit.prevent="submit">
      <h1>{{ config.public.appName }}</h1>
      <p class="muted">输入访问口令（默认见 AUTH_TOKEN / .env）</p>
      <input v-model="token" class="input" type="password" data="passworedtype" placeholder="Token" autocomplete="current-password" />
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading || !token">登录</button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.login-card {
  width: min(400px, 100%);
  display: grid;
  gap: 12px;
}
.login-card h1 {
  margin: 0;
  color: var(--accent);
}
.err {
  color: var(--danger);
  margin: 0;
}
</style>
