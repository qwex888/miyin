<script setup lang="ts">
type Task = {
  id: string
  title: string
  artist: string
  platform: string
  source_id: string | null
  quality: string | null
  status: string
  progress: number
  error: string | null
  attempts: number
  file_path: string | null
}

const tab = ref<'running' | 'completed' | 'failed'>('running')
const items = ref<Task[]>([])
const allItems = ref<Task[]>([])
let timer: any
let es: EventSource | null = null

const statusMap = {
  running: ['queued', 'running'],
  completed: ['completed'],
  failed: ['failed', 'cancelled'],
}

function applyFilter() {
  const allow = statusMap[tab.value]
  items.value = allItems.value.filter((t) => allow.includes(t.status))
}

function upsert(task: Task) {
  const idx = allItems.value.findIndex((t) => t.id === task.id)
  if (idx >= 0) allItems.value[idx] = task
  else allItems.value.unshift(task)
  applyFilter()
}

async function load() {
  const res = await $fetch<{ items: Task[] }>('/api/downloads')
  allItems.value = res.items
  applyFilter()
}

function connectSse() {
  try {
    es = new EventSource('/api/downloads/events')
    es.addEventListener('snapshot', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data)
      allItems.value = data.items || []
      applyFilter()
    })
    es.addEventListener('task', (ev) => {
      const task = JSON.parse((ev as MessageEvent).data)
      upsert(task)
    })
    es.onerror = () => {
      es?.close()
      es = null
      // 回退轮询
      if (!timer) timer = setInterval(load, 2000)
    }
  } catch {
    timer = setInterval(load, 2000)
  }
}

async function cancel(t: Task) {
  await $fetch(`/api/downloads/${t.id}`, { method: 'DELETE' })
  await load()
}

async function retry(t: Task) {
  await $fetch(`/api/downloads/${t.id}/retry`, { method: 'POST', body: { resetAttempts: true } })
  tab.value = 'running'
  await load()
}

watch(tab, applyFilter)
onMounted(() => {
  void load()
  connectSse()
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  es?.close()
})
</script>

<template>
  <div class="page">
    <div class="tabs">
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'running' }"
        @click="tab = 'running'"
      >
        进行中
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'completed' }"
        @click="tab = 'completed'"
      >
        已完成
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'failed' }" @click="tab = 'failed'">
        失败
      </button>
    </div>

    <div v-for="t in items" :key="t.id" class="card task">
      <div class="head">
        <strong>{{ t.title }} · {{ t.artist }}</strong>
        <span class="muted">{{ t.quality || '—' }} · {{ t.platform }}</span>
      </div>
      <div v-if="t.status === 'running' || t.status === 'queued'" class="bar">
        <div class="fill" :style="{ width: `${Math.round((t.progress || 0) * 100)}%` }" />
      </div>
      <div class="foot">
        <span class="muted">
          {{ t.status }}
          <template v-if="t.attempts"> · 尝试 {{ t.attempts }}</template>
          <template v-if="t.error"> · {{ t.error }}</template>
          <template v-if="t.file_path"> · {{ t.file_path }}</template>
        </span>
        <span class="ops">
          <button
            v-if="t.status === 'queued' || t.status === 'running'"
            class="btn btn-ghost"
            type="button"
            @click="cancel(t)"
          >
            取消
          </button>
          <button
            v-if="t.status === 'failed' || t.status === 'cancelled'"
            class="btn btn-ghost"
            type="button"
            @click="retry(t)"
          >
            重试
          </button>
        </span>
      </div>
    </div>
    <p v-if="!items.length" class="muted empty">当前分类没有任务</p>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}
.tab {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  padding: 6px 4px;
}
.tab.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom: 2px solid var(--accent);
}
.task {
  margin-bottom: 10px;
}
.head,
.foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.bar {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  margin: 10px 0;
}
.fill {
  height: 100%;
  background: var(--accent);
}
.ops {
  display: flex;
  gap: 6px;
}
.empty {
  text-align: center;
  padding: 40px;
}
</style>
