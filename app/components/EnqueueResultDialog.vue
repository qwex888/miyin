<script setup lang="ts">
export type EnqueueResultItem = {
  title: string
  ok: boolean
  method?: string
  error?: string
  taskId?: string
}

export type EnqueueResultPayload = {
  enqueued: number
  total: number
  batchId?: string
  results?: EnqueueResultItem[]
}

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    result?: EnqueueResultPayload | null
  }>(),
  {
    result: null,
  },
)

const emit = defineEmits<{
  close: []
  viewQueue: []
  retryFailed: [failedItems: EnqueueResultItem[]]
}>()

const items = computed(() => props.result?.results || [])
const failCount = computed(() => {
  if (!props.result) return 0
  return Math.max(0, props.result.total - props.result.enqueued)
})

const summaryText = computed(() => {
  if (!props.result) return ''
  const { enqueued, total } = props.result
  if (enqueued >= total && total > 0) return `已成功入队全部 ${enqueued} 首`
  if (enqueued === 0) return `未能入队（0 / ${total}）`
  return `成功入队 ${enqueued} / ${total} 首` + (failCount.value ? `，失败 ${failCount.value}` : '')
})
function onClose() {
  open.value = false
  emit('close')
}

function onRetryFailed() {
  const failed = items.value.filter((it) => !it.ok)
  open.value = false
  emit('retryFailed', failed)
}

async function onViewQueue() {
  open.value = false
  emit('viewQueue')
  await navigateTo('/queue')
}
function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') onClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open && result" class="overlay" role="presentation" @click.self="onClose">
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="enqueue-result-title"
        aria-describedby="enqueue-result-desc"
      >
        <div class="handle" aria-hidden="true" />
        <div class="header">
          <h2 id="enqueue-result-title" class="title">入队完成</h2>
          <p id="enqueue-result-desc" class="desc">{{ summaryText }}</p>
        </div>

        <div v-if="items.length" class="list" aria-label="入队明细">
          <div v-for="(item, i) in items" :key="i" class="result-row">
            <span class="mark" :class="item.ok ? 'ok' : 'err'">{{ item.ok ? '✓' : '✗' }}</span>
            <div class="result-body">
              <span class="result-title">{{ item.title }}</span>
              <span v-if="item.method || item.error" class="result-meta">
                <span v-if="item.method" class="muted">{{ item.method }}</span>
                <span v-if="item.error" class="err">{{ item.error }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="footer">
          <button
            v-if="failCount > 0"
            class="btn btn-retry"
            type="button"
            @click="onRetryFailed"
          >
            重试失败曲目 ({{ failCount }})
          </button>
          <button class="btn btn-ghost" type="button" @click="onClose">继续导入</button>
          <button class="btn" type="button" @click="onViewQueue">查看队列</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in oklab, #0f172a 40%, transparent);
  backdrop-filter: blur(2px);
}
.dialog {
  width: min(440px, 100%);
  max-height: min(80dvh, 560px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  padding: 20px;
  box-shadow: var(--shadow);
}
.handle {
  display: none;
}
.header {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
  flex-shrink: 0;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
}
.desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  -webkit-overflow-scrolling: touch;
}
.result-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.result-row:last-child {
  border-bottom: 0;
}
.mark {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  font-weight: 600;
  line-height: 1.4;
}
.mark.ok {
  color: var(--accent);
}
.mark.err,
.err {
  color: var(--danger);
}
.muted {
  color: var(--muted);
}
.result-body {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.result-title {
  line-height: 1.4;
  word-break: break-word;
}
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 12px;
  line-height: 1.4;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.footer .btn {
  min-width: 88px;
  padding: 7px 14px;
  font-size: 13px;
  border-radius: 8px;
}
.footer .btn-retry {
  background: var(--accent, #6366f1);
  color: #fff;
  border: none;
}
.footer .btn-retry:hover {
  opacity: 0.9;
}
@media (max-width: 768px) {
  .overlay {
    align-items: flex-end;
    padding: 0;
  }
  .dialog {
    width: 100%;
    max-width: none;
    max-height: min(88dvh, 640px);
    border-radius: 16px 16px 0 0;
    padding: 10px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .handle {
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: var(--border);
    margin: 2px auto 10px;
    flex-shrink: 0;
  }
  .title {
    font-size: 17px;
  }
  .footer {
    flex-direction: column-reverse;
  }
  .footer .btn {
    width: 100%;
    min-height: 44px;
  }
}
</style>
