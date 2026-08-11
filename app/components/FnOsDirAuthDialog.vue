<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  authorize: []
  dismiss: []
}>()

function onAuthorize() {
  emit('authorize')
}

function onDismiss() {
  emit('dismiss')
}

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') onDismiss()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" role="presentation">
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fnos-auth-dlg-title"
        aria-describedby="fnos-auth-dlg-desc"
      >
        <div class="handle" aria-hidden="true" />
        <div class="icon-wrap" aria-hidden="true">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
            <path d="M12 8v5" stroke-linecap="round" />
            <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div class="header">
          <h2 id="fnos-auth-dlg-title" class="title">需要授权下载目录</h2>
          <p id="fnos-auth-dlg-desc" class="desc">
            当前为自定义下载路径，应用尚未获得该目录的读写权限。未授权时下载可能失败或无法写入文件。
          </p>
        </div>
        <ul class="steps">
          <li>由<strong>管理员</strong>在设置中完成「授权当前路径」或「选择并授权目录」</li>
          <li>授权成功后<strong>重启应用</strong>，权限才会完全生效</li>
        </ul>
        <div class="footer">
          <button class="btn btn-ghost" type="button" @click="onDismiss">稍后提醒</button>
          <button class="btn" type="button" @click="onAuthorize">去授权</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in oklab, #0f172a 52%, transparent);
  backdrop-filter: blur(3px);
}
.dialog {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 6px);
  padding: 22px 20px 18px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.22);
}
.handle {
  display: none;
}
.icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, var(--surface));
  border: 1px solid color-mix(in oklab, var(--accent) 28%, var(--border));
}
.icon {
  width: 26px;
  height: 26px;
}
.header {
  display: grid;
  gap: 8px;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.3;
}
.desc {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.55;
}
.steps {
  margin: 0;
  padding: 12px 12px 12px 28px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  display: grid;
  gap: 8px;
}
.steps strong {
  color: var(--accent);
  font-weight: 600;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.footer .btn {
  min-width: 96px;
}

@media (max-width: 768px) {
  .overlay {
    align-items: flex-end;
    padding: 0;
  }
  .dialog {
    width: 100%;
    max-width: none;
    border-radius: 16px 16px 0 0;
    padding: 10px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    animation: fnos-sheet-up 0.22s ease-out;
  }
  .handle {
    display: block;
    width: 40px;
    height: 4px;
    margin: 4px auto 8px;
    border-radius: 999px;
    background: var(--border);
  }
  .footer {
    flex-direction: column-reverse;
  }
  .footer .btn {
    width: 100%;
    min-height: 44px;
  }
}

@keyframes fnos-sheet-up {
  from {
    transform: translateY(12%);
    opacity: 0.85;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
