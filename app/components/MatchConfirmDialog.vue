<script setup lang="ts">
export type MatchConfirmCandidate = {
  externalId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  score: number
  musicInfo?: Record<string, any>
}

export type MatchConfirmRow = {
  index: number
  track: {
    title: string
    artist: string
  }
  score: number
  candidates: MatchConfirmCandidate[]
  error?: string
}

const open = defineModel<boolean>('open', { default: false })
const choices = defineModel<Record<number, number | 'skip'>>('choices', { default: () => ({}) })

const props = withDefaults(
  defineProps<{
    rows?: MatchConfirmRow[]
    loading?: boolean
  }>(),
  {
    rows: () => [],
    loading: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onCancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}

function onConfirm() {
  if (props.loading) return
  emit('confirm')
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
        aria-labelledby="match-confirm-title"
        aria-describedby="match-confirm-desc"
      >
        <div class="handle" aria-hidden="true" />
        <div class="header">
          <h2 id="match-confirm-title" class="title">
            匹配确认（{{ rows.length }}）
          </h2>
          <p id="match-confirm-desc" class="desc">
            以下曲目匹配分较低或未命中，请选择候选项或跳过。
          </p>
        </div>

        <div class="list">
          <div v-for="row in rows" :key="row.index" class="confirm-item">
            <div class="confirm-title">
              <strong>{{ row.track.title }}</strong>
              <span class="muted"> · {{ row.track.artist }}</span>
              <span class="muted"> · 分 {{ row.score.toFixed(2) }}</span>
              <span v-if="row.error" class="err"> · {{ row.error }}</span>
            </div>
            <label class="choice" :class="{ active: choices[row.index] === 'skip' }">
              <input v-model="choices[row.index]" type="radio" value="skip" :disabled="loading" />
              跳过
            </label>
            <label
              v-for="(c, ci) in row.candidates"
              :key="ci"
              class="choice"
              :class="{ active: Number(choices[row.index]) === ci }"
            >
              <input
                v-model="choices[row.index]"
                type="radio"
                :value="ci"
                :disabled="loading"
              />
              <span class="choice-body">
                <span>{{ c.title }} · {{ c.artist }}</span>
                <span class="muted">({{ c.score.toFixed(2) }})</span>
              </span>
            </label>
            <p v-if="!row.candidates.length" class="empty-hint">无候选，只能跳过</p>
          </div>
        </div>

        <div class="footer">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">
            取消
          </button>
          <button class="btn" type="button" :disabled="loading" @click="onConfirm">
            {{ loading ? '入队中…' : '确认并入队' }}
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
  width: min(520px, 100%);
  max-height: min(82dvh, 640px);
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
  margin-bottom: 12px;
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
  margin-bottom: 14px;
  padding-right: 2px;
  -webkit-overflow-scrolling: touch;
}
.confirm-item {
  border-top: 1px solid var(--border);
  padding: 12px 0;
}
.confirm-item:first-child {
  border-top: 0;
  padding-top: 4px;
}
.confirm-title {
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger);
}
.choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 6px 0;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.4;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
}
.choice.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.choice input {
  margin-top: 2px;
  flex-shrink: 0;
}
.choice-body {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.empty-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
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

@media (max-width: 768px) {
  .overlay {
    align-items: flex-end;
    padding: 0;
  }
  .dialog {
    width: 100%;
    max-width: none;
    max-height: min(90dvh, 720px);
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
  .choice {
    min-height: 48px;
    align-items: center;
  }
  .choice input {
    margin-top: 0;
    width: 18px;
    height: 18px;
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
