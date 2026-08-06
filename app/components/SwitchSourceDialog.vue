<script setup lang="ts">
import type { SwitchSourceOption } from '~/composables/useSwitchSourcePreference'
import { resolveDefaultSwitchSourceId } from '~/composables/useSwitchSourcePreference'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    options?: SwitchSourceOption[]
    loading?: boolean
  }>(),
  {
    title: '选择音源',
    description: '选择后将使用该音源重新下载，并记住为默认选项。',
    confirmLabel: '换源下载',
    cancelLabel: '取消',
    options: () => [],
    loading: false,
  },
)

const emit = defineEmits<{
  confirm: [payload: { sourceId: string; source: SwitchSourceOption }]
  cancel: []
}>()

const selectedId = ref('')

watch(
  () => open.value,
  (v) => {
    if (!v) return
    selectedId.value = resolveDefaultSwitchSourceId(props.options) || ''
  },
)

watch(
  () => props.options,
  (opts) => {
    if (!open.value) return
    if (!opts.some((o) => o.id === selectedId.value)) {
      selectedId.value = resolveDefaultSwitchSourceId(opts) || ''
    }
  },
  { deep: true },
)

function onCancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}

function onConfirm() {
  if (props.loading) return
  const source = props.options.find((o) => o.id === selectedId.value)
  if (!source) return
  emit('confirm', { sourceId: source.id, source })
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
        :aria-labelledby="'switch-src-title'"
        :aria-describedby="'switch-src-desc'"
      >
        <div class="header">
          <h2 id="switch-src-title" class="title">{{ title }}</h2>
          <p id="switch-src-desc" class="desc">{{ description }}</p>
        </div>

        <div v-if="options.length" class="list" role="radiogroup" aria-label="音源列表">
          <label
            v-for="opt in options"
            :key="opt.id"
            class="option"
            :class="{ active: selectedId === opt.id }"
          >
            <input
              v-model="selectedId"
              type="radio"
              name="switch-source"
              :value="opt.id"
              :disabled="loading"
            />
            <span class="option-body">
              <span class="option-label">{{ opt.name }}</span>
              <span v-if="opt.platforms.length" class="option-hint">
                {{ opt.platforms.join(' / ') }}
              </span>
            </span>
          </label>
        </div>
        <p v-else class="empty">当前没有可用音源</p>

        <div class="footer">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">
            {{ cancelLabel }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="loading || !selectedId || !options.length"
            @click="onConfirm"
          >
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
  align-items: flex-start;
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
  margin-top: 3px;
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
.option-hint {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.empty {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
  padding: 20px 8px;
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
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .option {
    min-height: 48px;
    align-items: center;
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
