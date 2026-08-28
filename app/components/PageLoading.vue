<script setup lang="ts">
export type PageLoadingLog = {
  level?: string
  message: string
  name?: string
}

const props = withDefaults(
  defineProps<{
    show?: boolean
    text?: string
    logs?: PageLoadingLog[]
    /** 批处理已结束，等待用户确认关闭 */
    completed?: boolean
    completedText?: string
  }>(),
  {
    show: false,
    text: '加载中…',
    logs: () => [],
    completed: false,
    completedText: '处理完成',
  },
)

const emit = defineEmits<{
  confirm: []
}>()

const logBox = ref<HTMLElement | null>(null)
const followLatest = ref(true)

const showLogs = computed(() => (props.logs?.length || 0) > 0)

function formatLine(log: PageLoadingLog) {
  const level = log.level ? `[${log.level}] ` : ''
  const name = log.name ? `[${log.name}] ` : ''
  return `${level}${name}${log.message}`
}

function onLogScroll() {
  const el = logBox.value
  if (!el) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  followLatest.value = dist < 40
}

watch(
  () => [props.logs?.length, props.show, props.completed] as const,
  async () => {
    if (!followLatest.value || !props.show) return
    await nextTick()
    const el = logBox.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

watch(
  () => props.show,
  (v) => {
    if (v) followLatest.value = true
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
        :aria-busy="!completed"
        :class="{ 'is-completed': completed }"
      >
        <div class="page-loading-card" :class="{ 'with-logs': showLogs }">
          <span v-if="!completed" class="page-loading-spinner" aria-hidden="true" />
          <span v-else class="page-loading-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <p class="page-loading-text">{{ completed ? completedText || text : text }}</p>

          <div
            v-if="showLogs"
            ref="logBox"
            class="page-loading-logs"
            @scroll="onLogScroll"
          >
            <pre
              v-for="(log, i) in logs"
              :key="i"
              class="page-loading-log-line"
              :class="log.level || 'log'"
            >{{ formatLine(log) }}</pre>
          </div>

          <button
            v-if="completed"
            class="btn page-loading-confirm"
            type="button"
            @click="emit('confirm')"
          >
            确认
          </button>
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
.page-loading.is-completed {
  cursor: default;
  touch-action: auto;
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
.page-loading-card.with-logs {
  width: min(720px, 100%);
  max-width: min(720px, 100%);
  align-items: stretch;
}

.page-loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2.5px solid color-mix(in oklab, var(--accent) 25%, var(--border));
  border-top-color: var(--accent);
  animation: page-loading-spin 0.7s linear infinite;
  align-self: center;
  flex-shrink: 0;
}

.page-loading-check {
  width: 28px;
  height: 28px;
  color: var(--accent);
  align-self: center;
  flex-shrink: 0;
  display: inline-flex;
}
.page-loading-check svg {
  width: 28px;
  height: 28px;
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

.page-loading-logs {
  max-height: min(280px, 42vh);
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  text-align: left;
  -webkit-overflow-scrolling: touch;
}

.page-loading-log-line {
  margin: 0 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}
.page-loading-log-line:last-child {
  margin-bottom: 0;
}
.page-loading-log-line.warn {
  color: hsl(var(--warning));
}
.page-loading-log-line.error {
  color: var(--danger);
}

.page-loading-confirm {
  align-self: center;
  min-width: 96px;
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
  .page-loading-card.with-logs {
    width: 100%;
  }
  .page-loading-logs {
    max-height: min(160px, 36vh);
  }
  .page-loading-spinner,
  .page-loading-check,
  .page-loading-check svg {
    width: 26px;
    height: 26px;
  }
}
</style>
