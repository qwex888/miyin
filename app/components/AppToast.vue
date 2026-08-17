<script setup lang="ts">
import type { ToastType } from '~/composables/useToast'

const { toasts, dismiss } = useToast()

const typeLabel: Record<ToastType, string> = {
  success: '成功',
  error: '错误',
  warning: '警告',
  info: '提示',
}
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-relevant="additions text">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.type}`"
        role="status"
      >
        <span class="toast-badge" aria-hidden="true">{{ typeLabel[t.type] }}</span>
        <p class="toast-msg">{{ t.message }}</p>
        <button
          class="toast-close"
          type="button"
          aria-label="关闭提示"
          @click="dismiss(t.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  /* 高于 Loading(200) 与各类弹窗，保证提示始终置顶 */
  z-index: 10100;
  top: max(12px, env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 8px 10px;
  padding: 10px 12px;
  border-radius: calc(var(--radius) - 2px);
  border: 1px solid var(--toast-border, var(--border));
  background: var(--toast-bg, var(--surface));
  color: var(--toast-fg, var(--text));
  box-shadow: var(--shadow);
  font-size: 13px;
  line-height: 1.45;
}

.toast-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: var(--toast-badge-bg);
  color: var(--toast-badge-fg);
  white-space: nowrap;
}

.toast-msg {
  margin: 0;
  padding-top: 1px;
  word-break: break-word;
}

.toast-close {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  width: 24px;
  height: 24px;
  margin: -2px -4px 0 0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toast-close:hover {
  background: hsl(var(--secondary));
  color: var(--text);
}

.toast-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.toast--success {
  --toast-bg: var(--toast-success-bg);
  --toast-fg: var(--toast-success-fg);
  --toast-border: var(--toast-success-border);
  --toast-badge-bg: hsl(var(--success));
  --toast-badge-fg: #fff;
}

.toast--error {
  --toast-bg: var(--toast-error-bg);
  --toast-fg: var(--toast-error-fg);
  --toast-border: var(--toast-error-border);
  --toast-badge-bg: var(--danger);
  --toast-badge-fg: #fff;
}

.toast--warning {
  --toast-bg: var(--toast-warning-bg);
  --toast-fg: var(--toast-warning-fg);
  --toast-border: var(--toast-warning-border);
  --toast-badge-bg: hsl(var(--warning));
  --toast-badge-fg: #1c1917;
}

.toast--info {
  --toast-bg: var(--toast-info-bg);
  --toast-fg: var(--toast-info-fg);
  --toast-border: var(--toast-info-border);
  --toast-badge-bg: hsl(var(--info));
  --toast-badge-fg: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.toast-move {
  transition: transform 0.2s ease;
}

@media (max-width: 768px) {
  .toast-host {
    top: max(10px, env(safe-area-inset-top, 0px));
    width: calc(100vw - 20px);
  }
  .toast {
    padding: 10px;
    font-size: 13px;
  }
}
</style>
