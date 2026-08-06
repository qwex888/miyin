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
  lyric_path: string | null
  file_size: number | null
}

const tab = ref<'running' | 'completed' | 'failed'>('running')
const items = ref<Task[]>([])
const allItems = ref<Task[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const msg = ref('')
const deleteDialogOpen = ref(false)
const deleteDialogTitle = ref('确认删除')
const deleteDialogDesc = ref('')
let deletePending: null | { mode: 'one'; task: Task } | { mode: 'batch' } = null
let timer: any
let es: EventSource | null = null

const statusMap = {
  running: ['queued', 'running'],
  completed: ['completed'],
  failed: ['failed', 'cancelled'],
}

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

function formatSize(n: number | null | undefined) {
  if (n == null || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function progressPct(t: Task) {
  return Math.min(100, Math.max(0, Math.round((t.progress || 0) * 100)))
}

const statusLabel: Record<string, string> = {
  queued: '排队中',
  running: '下载中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusText(s: string) {
  return statusLabel[s] || s
}

function applyFilter() {
  const allow = statusMap[tab.value]
  items.value = allItems.value.filter((t) => allow.includes(t.status))
  const ids = new Set(items.value.map((t) => t.id))
  selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
}

function upsert(task: Task) {
  if ((task as any).status === 'deleted') {
    allItems.value = allItems.value.filter((t) => t.id !== task.id)
    selected.value.delete(task.id)
    selected.value = new Set(selected.value)
    applyFilter()
    return
  }
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
    const base = (useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')
    es = new EventSource(`${base}api/downloads/events`)
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
      if (!timer) timer = setInterval(load, 2000)
    }
  } catch {
    timer = setInterval(load, 2000)
  }
}

function toggleOne(id: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(id)
  else next.delete(id)
  selected.value = next
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
    return
  }
  selected.value = new Set(items.value.map((t) => t.id))
}

async function cancel(t: Task) {
  if (!confirm(`确认取消任务「${t.title}」？未完成文件将被删除；若已完成也会删除本地文件。`)) return
  await $fetch(`/api/downloads/${t.id}`, { method: 'DELETE' })
  await load()
  useDownloadBadge().notifyChanged()
}

async function retry(t: Task) {
  await $fetch(`/api/downloads/${t.id}/retry`, { method: 'POST', body: { resetAttempts: true } })
  tab.value = 'running'
  await load()
  useDownloadBadge().notifyChanged()
}

async function switchSource(t: Task) {
  loading.value = true
  msg.value = ''
  try {
    const res = await $fetch<{ sourceName: string }>(`/api/downloads/${t.id}/switch-source`, {
      method: 'POST',
    })
    tab.value = 'running'
    msg.value = `已切换至音源「${res.sourceName}」并重试`
    await load()
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '换源失败'
  } finally {
    loading.value = false
  }
}

async function deleteOne(t: Task) {
  deletePending = { mode: 'one', task: t }
  deleteDialogTitle.value = '删除任务'
  deleteDialogDesc.value = `确定删除「${t.title}」吗？默认仅删除队列记录，可勾选同时删除本地文件。`
  deleteDialogOpen.value = true
}

async function batchDelete() {
  if (!selectedCount.value) return
  const label = tab.value === 'failed' ? '失败/取消' : '已完成'
  deletePending = { mode: 'batch' }
  deleteDialogTitle.value = '批量删除'
  deleteDialogDesc.value = `确定删除选中的 ${selectedCount.value} 条${label}任务吗？默认仅删除队列记录，可勾选同时删除本地文件。`
  deleteDialogOpen.value = true
}

async function onDeleteConfirm(payload: { deleteLocalFiles: boolean }) {
  const pending = deletePending
  if (!pending) {
    deleteDialogOpen.value = false
    return
  }
  loading.value = true
  msg.value = ''
  try {
    if (pending.mode === 'one') {
      const t = pending.task
      await $fetch(`/api/downloads/${t.id}/purge`, {
        method: 'POST',
        body: { deleteLocalFiles: payload.deleteLocalFiles },
      })
      selected.value.delete(t.id)
      selected.value = new Set(selected.value)
      msg.value = payload.deleteLocalFiles ? '已删除任务与本地文件' : '已删除任务记录'
    } else {
      const res = await $fetch<{ deleted: number }>('/api/downloads/batch-delete', {
        method: 'POST',
        body: { ids: [...selected.value], deleteLocalFiles: payload.deleteLocalFiles },
      })
      selected.value = new Set()
      msg.value =
        `已删除 ${res.deleted} 条` + (payload.deleteLocalFiles ? '（含本地文件）' : '')
    }
    deleteDialogOpen.value = false
    deletePending = null
    await load()
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '删除失败'
  } finally {
    loading.value = false
  }
}

function onDeleteCancel() {
  deletePending = null
}

async function batchCancel() {
  if (!selectedCount.value) return
  if (!confirm(`确认取消选中的 ${selectedCount.value} 个下载任务？将删除未完成（及竞态已完成）的本地文件。`))
    return
  loading.value = true
  try {
    await $fetch('/api/downloads/batch-cancel', {
      method: 'POST',
      body: { ids: [...selected.value] },
    })
    selected.value = new Set()
    msg.value = '已批量取消'
    await load()
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '批量取消失败'
  } finally {
    loading.value = false
  }
}

async function batchRetry() {
  if (!selectedCount.value) return
  if (!confirm(`确认重试选中的 ${selectedCount.value} 个失败任务？`)) return
  loading.value = true
  try {
    await $fetch('/api/downloads/batch-retry', {
      method: 'POST',
      body: { ids: [...selected.value], resetAttempts: true },
    })
    selected.value = new Set()
    tab.value = 'running'
    msg.value = '已批量重试'
    await load()
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '批量重试失败'
  } finally {
    loading.value = false
  }
}

async function batchSwitchSource() {
  if (!selectedCount.value) return
  if (!confirm(`确认对选中的 ${selectedCount.value} 个任务换源并重试？`)) return
  loading.value = true
  try {
    const res = await $fetch<{ items: Array<{ sourceName?: string; error?: string }> }>(
      '/api/downloads/batch-switch-source',
      { method: 'POST', body: { ids: [...selected.value] } },
    )
    const ok = res.items.filter((i) => !i.error).length
    const fail = res.items.length - ok
    selected.value = new Set()
    tab.value = 'running'
    msg.value = `换源重试：成功 ${ok}` + (fail ? `，失败 ${fail}` : '')
    await load()
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '批量换源失败'
  } finally {
    loading.value = false
  }
}

watch(tab, () => {
  selected.value = new Set()
  applyFilter()
})
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

    <div class="toolbar">
      <label class="check">
        <input type="checkbox" :checked="allSelected" :disabled="!items.length" @change="toggleAll" />
        全选当前
      </label>
      <template v-if="selectedCount">
        <template v-if="tab === 'running'">
          <button class="btn btn-danger btn-sm" type="button" :disabled="loading" @click="batchCancel">
            批量取消（{{ selectedCount }}）
          </button>
        </template>
        <template v-else-if="tab === 'completed'">
          <button class="btn btn-danger btn-sm" type="button" :disabled="loading" @click="batchDelete">
            批量删除（{{ selectedCount }}）
          </button>
        </template>
        <template v-else>
          <button class="btn btn-sm" type="button" :disabled="loading" @click="batchRetry">
            批量重试（{{ selectedCount }}）
          </button>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="loading" @click="batchSwitchSource">
            批量换源（{{ selectedCount }}）
          </button>
          <button class="btn btn-danger btn-sm" type="button" :disabled="loading" @click="batchDelete">
            批量删除（{{ selectedCount }}）
          </button>
        </template>
      </template>
    </div>
    <p v-if="msg" class="tip">{{ msg }}</p>

    <VirtualList
      v-if="items.length"
      :key="tab"
      :items="items"
      :estimate-size="80"
      max-height="calc(100vh - 220px)"
    >
      <template #default="{ item: t }">
        <div class="task">
          <label class="task-check">
            <input
              type="checkbox"
              :checked="selected.has(t.id)"
              @change="toggleOne(t.id, ($event.target as HTMLInputElement).checked)"
            />
          </label>

          <div class="task-main">
            <div class="task-top">
              <div class="task-title" :title="`${t.title} · ${t.artist}`">
                <span class="name">{{ t.title }}</span>
                <span class="sep">·</span>
                <span class="artist">{{ t.artist }}</span>
              </div>
              <span class="badge" :class="`badge-${t.status}`">{{ statusText(t.status) }}</span>
            </div>

            <div class="task-meta">
              <span>{{ t.platform }}</span>
              <span v-if="t.quality">{{ t.quality }}</span>
              <span v-if="t.file_size">{{ formatSize(t.file_size) }}</span>
              <span v-if="t.attempts">尝试 {{ t.attempts }}</span>
            </div>

            <div v-if="t.status === 'running' || t.status === 'queued'" class="progress">
              <div class="progress-track">
                <div class="progress-fill" :style="{ width: `${progressPct(t)}%` }" />
              </div>
              <span class="progress-num">{{ progressPct(t) }}%</span>
            </div>

            <p v-if="t.error" class="task-err" :title="t.error">{{ t.error }}</p>
            <p v-else-if="t.file_path" class="task-path" :title="t.file_path">{{ t.file_path }}</p>
          </div>

          <div class="task-ops">
            <button
              v-if="t.status === 'queued' || t.status === 'running'"
              class="btn btn-ghost btn-sm"
              type="button"
              @click="cancel(t)"
            >
              取消
            </button>
            <button
              v-if="t.status === 'completed'"
              class="btn btn-ghost btn-sm"
              type="button"
              @click="deleteOne(t)"
            >
              删除
            </button>
            <button
              v-if="t.status === 'failed' || t.status === 'cancelled'"
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="loading"
              @click="retry(t)"
            >
              重试
            </button>
            <button
              v-if="t.status === 'failed' || t.status === 'cancelled'"
              class="btn btn-sm"
              type="button"
              :disabled="loading"
              @click="switchSource(t)"
            >
              换源
            </button>
            <button
              v-if="t.status === 'failed' || t.status === 'cancelled'"
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="loading"
              @click="deleteOne(t)"
            >
              删除
            </button>
          </div>
        </div>
      </template>
    </VirtualList>
    <p v-else class="muted empty">当前分类没有任务</p>

    <DeleteConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDesc"
      :loading="loading"
      confirm-label="删除"
      @confirm="onDeleteConfirm"
      @cancel="onDeleteCancel"
    />
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
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.task {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: center;
  margin: 0 0 8px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-sizing: border-box;
  min-height: calc(100% - 8px);
  height: auto;
  max-height: calc(100% - 8px);
  overflow: hidden;
}
.task-check {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 0;
  cursor: pointer;
}
.task-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.task-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.task-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.35;
}
.task-title .name {
  font-weight: 600;
}
.task-title .sep {
  color: var(--muted);
  margin: 0 4px;
}
.task-title .artist {
  color: var(--muted);
  font-weight: 400;
}
.badge {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 999px;
  background: hsl(var(--muted-bg));
  color: var(--muted);
}
.badge-running {
  background: var(--accent-soft);
  color: var(--accent);
}
.badge-queued {
  background: hsl(var(--info-soft));
  color: hsl(var(--info));
}
.badge-completed {
  background: hsl(var(--success-soft));
  color: hsl(var(--success));
}
.badge-failed {
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
}
.badge-cancelled {
  background: hsl(var(--muted-bg));
  color: var(--muted);
}
.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.3;
}

.progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
  max-width: 280px;
  margin-top: 2px;
}
.progress-track {
  height: 4px;
  background: hsl(var(--muted-bg));
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.15s ease;
}
.progress-num {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  font-weight: 600;
  text-align: right;
}

.task-err,
.task-path {
  margin: 0;
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-err {
  color: var(--danger);
}
.task-path {
  color: var(--muted);
}

.task-ops {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 6px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  white-space: nowrap;
}

.empty {
  text-align: center;
  padding: 40px;
}
.tip {
  color: var(--accent);
  margin: 0 0 8px;
}

@media (max-width: 560px) {
  .task {
    grid-template-columns: 28px minmax(0, 1fr);
    max-height: none;
  }
  .task-ops {
    grid-column: 2;
  }
  .progress {
    max-width: none;
  }
}
</style>
