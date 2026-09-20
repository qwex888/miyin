<script setup lang="ts">
export type SearchTrack = {
  id: string
  externalId: string
  title: string
  artist: string
  album: string
  albumId?: string
  duration: number
  platform: string
  cover?: string
  qualitys: string[]
  musicInfo: Record<string, any>
}

const props = withDefaults(
  defineProps<{
    items: SearchTrack[]
    /** 当前详情面板选中的曲目（高亮用） */
    selectedId?: string | null
    hasMore?: boolean
    loadingMore?: boolean
    /** 父级正在入队：禁用批量按钮，避免重复提交 */
    enqueueing?: boolean
    /** 超过该数量需二次确认，防止误选几百首瞬间打满音源并发 */
    confirmThreshold?: number
  }>(),
  {
    selectedId: null,
    hasMore: false,
    loadingMore: false,
    enqueueing: false,
    confirmThreshold: 100,
  },
)

const emit = defineEmits<{
  select: [item: SearchTrack]
  enqueue: [tracks: SearchTrack[]]
  loadMore: []
}>()

/** 用 Track.id（`平台:外部ID`，天然唯一）作为选择键：加载更多追加时不会错位 */
const selectedIds = ref<Set<string>>(new Set())
const pendingConfirm = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

const selectedTracks = computed(() => props.items.filter((t) => selectedIds.value.has(t.id)))
const selectedCount = computed(() => selectedTracks.value.length)
const allSelected = computed(() => props.items.length > 0 && selectedCount.value === props.items.length)
const needConfirm = computed(() => selectedCount.value > props.confirmThreshold)

function clearConfirmTimer() {
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
}

function resetConfirm() {
  pendingConfirm.value = false
  clearConfirmTimer()
}

function toggleOne(id: string, checked: boolean) {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
  resetConfirm()
}

function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(props.items.map((t) => t.id))
  resetConfirm()
}

function clearSelection() {
  selectedIds.value = new Set()
  resetConfirm()
}

function onCheckboxClick(e: MouseEvent) {
  // 复选框只切换选择，不触发行选中（详情面板）
  e.stopPropagation()
}

function onEnqueueClick() {
  if (!selectedCount.value || props.enqueueing) return
  if (needConfirm.value && !pendingConfirm.value) {
    pendingConfirm.value = true
    clearConfirmTimer()
    confirmTimer = setTimeout(() => {
      pendingConfirm.value = false
      confirmTimer = null
    }, 6000)
    return
  }
  const tracks = selectedTracks.value
  resetConfirm()
  // 提交后清空选择，避免重复点按造成二次入队；失败项仍可在结果弹窗中重试
  selectedIds.value = new Set()
  emit('enqueue', tracks)
}

function fmtDur(sec: number) {
  const s = Math.max(0, Math.round(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

onBeforeUnmount(clearConfirmTimer)
</script>

<template>
  <div class="song-list">
    <div class="toolbar">
      <label class="check">
        <input
          type="checkbox"
          :checked="allSelected"
          :disabled="!items.length || enqueueing"
          @change="toggleAll"
        />
        <span>全选（已加载 {{ items.length }} 首）</span>
      </label>
      <div class="toolbar-actions">
        <button v-if="pendingConfirm" class="btn btn-ghost btn-sm" type="button" @click="resetConfirm">
          取消
        </button>
        <button
          class="btn btn-sm"
          :class="{ 'btn-danger': pendingConfirm }"
          type="button"
          :disabled="!selectedCount || enqueueing"
          @click="onEnqueueClick"
        >
          {{ pendingConfirm ? `确认下载 ${selectedCount} 首` : `下载选中（${selectedCount}）` }}
        </button>
        <button
          v-if="selectedCount"
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="enqueueing"
          @click="clearSelection"
        >
          清空选择
        </button>
      </div>
    </div>

    <VirtualList
      v-if="items.length"
      :items="items"
      :estimate-size="64"
      :has-more="hasMore"
      :loading="loadingMore"
      fill
      @load-more="emit('loadMore')"
    >
      <template #default="{ item }">
        <div class="row" :class="{ active: selectedId === item.id }" @click="emit('select', item)">
          <label class="row-check" @click="onCheckboxClick">
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleOne(item.id, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <CoverImage :src="item.cover" class="cover" :alt="item.title" />
          <div class="meta">
            <div class="title">{{ item.title }}</div>
            <div class="muted">{{ item.artist }} · {{ fmtDur(item.duration) }}</div>
          </div>
        </div>
      </template>
    </VirtualList>
    <p v-else class="muted empty">暂无结果，输入关键词搜索</p>
    <p v-if="loadingMore" class="muted list-footer">加载中…</p>
    <p v-else-if="items.length && !hasMore" class="muted list-footer">没有更多了</p>
  </div>
</template>

<style scoped>
.song-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  box-sizing: border-box;
}
.row:hover,
.row.active {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}
.row-check {
  display: flex;
  align-items: center;
  padding: 4px;
  flex-shrink: 0;
  cursor: pointer;
}
.cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--accent-soft);
}
.meta {
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta .muted {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 24px;
  text-align: center;
}
.list-footer {
  flex-shrink: 0;
  padding: 8px;
  text-align: center;
  font-size: 12px;
}
@media (max-width: 768px) {
  .toolbar {
    align-items: stretch;
  }
  .toolbar-actions {
    width: 100%;
  }
  .toolbar-actions .btn {
    flex: 1;
    min-height: 36px;
  }
}
</style>
