<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 是否显示「同时删除本地文件」选项 */
    showDeleteFiles?: boolean
    /** 本地文件选项默认勾选 */
    defaultDeleteFiles?: boolean
    loading?: boolean
  }>(),
  {
    title: '确认删除',
    description: '此操作不可撤销。',
    confirmLabel: '删除',
    cancelLabel: '取消',
    showDeleteFiles: true,
    defaultDeleteFiles: false,
    loading: false,
  },
)

const emit = defineEmits<{
  confirm: [payload: { deleteLocalFiles: boolean }]
  cancel: []
}>()

const deleteLocalFiles = ref(false)

watch(
  () => open.value,
  (v) => {
    if (v) deleteLocalFiles.value = props.defaultDeleteFiles
  },
)

function onCancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}

function onConfirm() {
  if (props.loading) return
  emit('confirm', { deleteLocalFiles: props.showDeleteFiles ? deleteLocalFiles.value : false })
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
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'del-dlg-title'"
        :aria-describedby="'del-dlg-desc'"
      >
        <div class="header">
          <h2 id="del-dlg-title" class="title">{{ title }}</h2>
          <p id="del-dlg-desc" class="desc">{{ description }}</p>
        </div>

        <label v-if="showDeleteFiles" class="option">
          <input v-model="deleteLocalFiles" type="checkbox" :disabled="loading" />
          <span>
            <span class="option-label">同时删除本地文件</span>
            <span class="option-hint">勾选后将删除音频与歌词文件；不勾选则仅删除任务记录</span>
          </span>
        </label>

        <div class="footer">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">
            {{ cancelLabel }}
          </button>
          <button class="btn btn-danger" type="button" :disabled="loading" @click="onConfirm">
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
}
.header {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
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
.option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
}
.option input {
  margin-top: 2px;
  flex-shrink: 0;
}
.option-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
.option-hint {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
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
