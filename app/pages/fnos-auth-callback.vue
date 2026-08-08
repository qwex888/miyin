<script setup lang="ts">
import { parseFnOsAuthCallback, useFnOsDirAuth } from '~/composables/useFnOsDirAuth'

definePageMeta({
  layout: false,
})

const { AUTH_MSG_TYPE } = useFnOsDirAuth()
const message = ref('正在处理授权结果…')

onMounted(() => {
  const result = parseFnOsAuthCallback()
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: AUTH_MSG_TYPE,
          result,
        },
        window.location.origin,
      )
      message.value = '授权结果已回传，可关闭本窗口。'
    } else {
      message.value = '授权已完成。请返回觅音应用并点击「刷新授权状态」。'
    }
  } catch {
    message.value = '授权已完成。请返回觅音应用并点击「刷新授权状态」。'
  }
  try {
    window.close()
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div class="wrap">
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  font-family: system-ui, sans-serif;
  color: #333;
  background: #f6f7f9;
}
</style>
