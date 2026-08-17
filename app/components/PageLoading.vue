<script setup lang="ts">
withDefaults(
  defineProps<{
    show?: boolean
    text?: string
  }>(),
  {
    show: false,
    text: '加载中…',
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="page-loading">
      <div
        v-if="show"
        class="page-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="page-loading-card">
          <span class="page-loading-spinner" aria-hidden="true" />
          <p class="page-loading-text">{{ text }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 高于抽屉/冲突弹窗（50–110），低于 Toast（10050），保证导入进度始终可见 */
.page-loading {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  cursor: wait;
  touch-action: none;
}

.page-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-width: 120px;
  max-width: min(520px, 100%);
  padding: 18px 22px;
  border-radius: calc(var(--radius) + 2px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}

.page-loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2.5px solid color-mix(in oklab, var(--accent) 25%, var(--border));
  border-top-color: var(--accent);
  animation: page-loading-spin 0.7s linear infinite;
}

.page-loading-text {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  text-align: center;
  line-height: 1.4;
  word-break: break-word;
}

@keyframes page-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.page-loading-enter-active,
.page-loading-leave-active {
  transition: opacity 0.15s ease;
}
.page-loading-enter-from,
.page-loading-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .page-loading-card {
    padding: 16px 18px;
  }
  .page-loading-spinner {
    width: 26px;
    height: 26px;
  }
}
</style>
