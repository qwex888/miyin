<script setup lang="ts">
import { DOWNLOAD_QUALITY_OPTIONS, type DownloadQuality } from '~/utils/mediaLabels'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 打开时预选音质（仅本任务，不记忆） */
    currentQuality?: string | null
    loading?: boolean
  }>(),
  {
    title: '更换音质',
    description: '仅对本任务生效，不会改全局默认音质，也不会影响其他下载任务。',
    confirmLabel: '换音质下载',
    cancelLabel: '取消',
    currentQuality: null,
    loading: false,
  },
)

const emit = defineEmits<{
  confirm: [payload: { quality: DownloadQuality }]
  cancel: []
}>()

const selected = ref<DownloadQuality>('highest')

function resolveInitial(): DownloadQuality {
  const cur = props.currentQuality
  if (cur && DOWNLOAD_QUALITY_OPTIONS.some((o) => o.id === cur)) {
    return cur as DownloadQuality
  }
  return 'highest'
}

watch(
  () => open.value,
  (v) => {
    if (!v) return
    selected.value = resolveInitial()
  },
)

function onCancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}

function onConfirm() {
  if (props.loading) return
  if (!DOWNLOAD_QUALITY_OPTIONS.some((o) => o.id === selected.value)) return
  emit('confirm', { quality: selected.value })
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') onCancel()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" role="presentation" @click.self="onCancel">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-quality-title"
        aria-describedby="switch-quality-desc"
      >
        <div class="handle" aria-hidden="true" />
        <div class="header">
          <h2 id="switch-quality-title" class="title">{{ title }}</h2>
          <p id="switch-quality-desc" class="desc">{{ description }}</p>
        </div>

        <div class="list" role="radiogroup" aria-label="音质列表">
          <label
            v-for="opt in DOWNLOAD_QUALITY_OPTIONS"
            :key="opt.id"
            class="option"
            :class="{ active: selected === opt.id }"
          >
            <input
              v-model="selected"
              type="radio"
              name="switch-quality"
              :value="opt.id"
              :disabled="loading"
            />
            <span class="option-body">
              <span class="option-label">{{ opt.label }}</span>
            </span>
          </label>
        </div>

        <div class="footer">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">
            {{ cancelLabel }}
          </button>
          <button class="btn" type="button" :disabled="loading || !selected" @click="onConfirm">
            {{ loading ? '处理中…' : confirmLabel }}
          </button>
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
  width: min(420px, 100%);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  padding: 20px;
  box-shadow: var(--shadow);
  max-height: min(80dvh, 560px);
  display: flex;
  flex-direction: column;
  min-height: 0;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  min-height: 0;
  flex: 1;
  margin-bottom: 16px;
  padding-right: 2px;
}
.option {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
}
.option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.option input {
  flex-shrink: 0;
}
.option-body {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.option-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.footer .btn {
  min-width: 72px;
  padding: 7px 14px;
  font-size: 13px;
  border-radius: 8px;
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
    max-height: min(88dvh, 640px);
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
  .option {
    min-height: 48px;
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
