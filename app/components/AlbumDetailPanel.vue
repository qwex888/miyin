<script setup lang="ts">
import {
  DOWNLOAD_QUALITY_OPTIONS,
  type DownloadQuality,
} from '~/utils/mediaLabels'
import { buildDedupKey } from '#shared/trackKey'

export type AlbumTrack = {
  externalId: string
  title: string
  artist: string
  album?: string
  duration?: number
  platform: string
  musicInfo: Record<string, any>
}

export type AlbumDetailData = {
  album: {
    id: string
    externalId: string
    title: string
    artist: string
    trackCount?: number
    cover?: string
    platform: string
  }
  tracks: AlbumTrack[]
}

const props = withDefaults(
  defineProps<{
    detail: AlbumDetailData
    loading?: boolean
    quality: DownloadQuality
    withLyric: boolean
    lyricMode: 'external' | 'embedded'
    albumDownloadToFolder: boolean
    albumFolderTemplate: string
    /** 全屏详情（H5）显示返回；PC 侧栏内嵌时可关闭 */
    showBack?: boolean
    /** 「已在库」徽标（C3）：命中下载记录的 `dedupKey` 集合 */
    libraryKeys?: Set<string>
    /** 还有未加载的曲目（触底 / 手动继续加载） */
    hasMore?: boolean
    loadingMore?: boolean
    /** 专辑总集数；上游谎报或未知时为 null → 只显示「已加载 N 集」 */
    totalCount?: number | null
  }>(),
  {
    loading: false,
    showBack: true,
    libraryKeys: () => new Set<string>(),
    hasMore: false,
    loadingMore: false,
    totalCount: null,
  },
)

const emit = defineEmits<{
  back: []
  enqueue: [indices: number[]]
  /** 整专下载：由父组件走服务端流式翻页，不受「已加载」限制 */
  enqueueAll: []
  loadMore: []
  'update:quality': [v: DownloadQuality]
  'update:withLyric': [v: boolean]
  'update:lyricMode': [v: 'external' | 'embedded']
  'update:albumDownloadToFolder': [v: boolean]
  'update:albumFolderTemplate': [v: string]
}>()

const selected = ref<Set<number>>(new Set())

/** 判定复用 shared/trackKey，与服务端判重口径严格一致 */
function inLibrary(track: AlbumTrack) {
  return props.libraryKeys.has(buildDedupKey(track.artist, track.title))
}

const folderPreview = computed(() => {
  if (!props.albumDownloadToFolder) return ''
  const album = props.detail.album
  return props.albumFolderTemplate
    .replaceAll('{album}', album.title || '')
    .replaceAll('{artist}', album.artist || '')
    .replaceAll('{platform}', album.platform || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
})

const allSelected = computed(() => {
  const n = props.detail.tracks.length
  return n > 0 && selected.value.size === n
})

watch(
  () => props.detail,
  (d) => {
    selected.value = new Set(d.tracks.map((_, i) => i))
  },
  { immediate: true },
)

/**
 * 追加分页后：若追加前是「全选」状态，则把新加载的曲目也一并选中，
 * 与用户心智一致（否则会变成「全选」只选了前 500 集）。
 */
watch(
  () => props.detail.tracks.length,
  (len, prev) => {
    if (!prev || len <= prev) return
    if (selected.value.size >= prev) {
      selected.value = new Set(props.detail.tracks.map((_, i) => i))
    }
  },
)

function fmtDur(sec?: number) {
  const s = Math.max(0, Math.round(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function toggleOne(i: number, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(i)
  else next.delete(i)
  selected.value = next
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
    return
  }
  selected.value = new Set(props.detail.tracks.map((_, i) => i))
}

function enqueueSelected() {
  emit('enqueue', [...selected.value].sort((a, b) => a - b))
}

/** 整专下载：不依赖已加载的曲目，交给父组件走服务端翻页 */
function enqueueAll() {
  emit('enqueueAll')
}

const loadedText = computed(() => {
  const base =
    props.totalCount && props.totalCount > 0
      ? `已加载 ${props.detail.tracks.length} / 共 ${props.totalCount} 集`
      : `已加载 ${props.detail.tracks.length} 集`
  return props.loadingMore ? `${base}（补齐中…）` : base
})
</script>

<template>
  <div class="album-detail">
    <div class="head">
      <button v-if="showBack" class="btn btn-ghost back-btn" type="button" @click="emit('back')">← 返回</button>
      <div class="album-meta">
        <CoverImage :src="detail.album.cover" class="cover" :alt="detail.album.title" :lazy="false" />
        <div>
          <h2>{{ detail.album.title }}</h2>
          <p class="muted">{{ detail.album.artist }}</p>
          <p class="muted">{{ loadedText }} · {{ detail.album.platform }}</p>
        </div>
      </div>
    </div>

    <div class="opts">
      <label class="field-inline">
        <span>音质</span>
        <select
          :value="quality"
          class="select"
          @change="emit('update:quality', ($event.target as HTMLSelectElement).value as DownloadQuality)"
        >
          <option v-for="opt in DOWNLOAD_QUALITY_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="check">
        <input
          :checked="withLyric"
          type="checkbox"
          @change="emit('update:withLyric', ($event.target as HTMLInputElement).checked)"
        />
        下载歌词
      </label>
      <label v-if="withLyric" class="field-inline">
        <span>歌词写入</span>
        <select
          :value="lyricMode"
          class="select"
          @change="emit('update:lyricMode', ($event.target as HTMLSelectElement).value as 'external' | 'embedded')"
        >
          <option value="external">仅外部 .lrc</option>
          <option value="embedded">仅内嵌到音频</option>
        </select>
      </label>
      <label class="check">
        <input
          :checked="albumDownloadToFolder"
          type="checkbox"
          @change="emit('update:albumDownloadToFolder', ($event.target as HTMLInputElement).checked)"
        />
        按文件夹下载
      </label>
      <label v-if="albumDownloadToFolder" class="field-inline folder-field">
        <span>文件夹命名</span>
        <input
          :value="albumFolderTemplate"
          class="input"
          placeholder="{album}"
          @input="emit('update:albumFolderTemplate', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <p v-if="albumDownloadToFolder" class="folder-hint muted">
        预览：{{ folderPreview || '（空，将平铺）' }}{{ folderPreview ? '/' : '' }}
        · 文件名仍用设置里的命名模板 · 可用 {album} {artist} {platform}
      </p>
    </div>

    <div class="toolbar">
      <div class="toolbar-left">
        <label class="check">
          <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          全选（已选 {{ selected.size }} / 已加载 {{ detail.tracks.length }}）
        </label>
        <!-- 底部「加载更多」在长列表里会被滚出视野，这里给一个常驻入口 -->
        <button
          v-if="hasMore || loadingMore"
          class="more-link"
          type="button"
          :disabled="loadingMore"
          @click="emit('loadMore')"
        >
          {{ loadingMore ? '补齐中…' : '加载更多' }}
        </button>
        <span v-else-if="detail.tracks.length >= 30" class="muted more-done">已全部加载</span>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" type="button" :disabled="!selected.size || loading" @click="enqueueSelected">
          下载选中
        </button>
        <button class="btn" type="button" :disabled="!detail.tracks.length || loading" @click="enqueueAll">
          {{ loading ? '入队中…' : totalCount ? `整专下载（${totalCount} 集）` : '整专下载' }}
        </button>
      </div>
    </div>

    <div class="track-list">
      <VirtualList
        v-if="detail.tracks.length"
        :items="detail.tracks"
        :estimate-size="52"
        :dynamic="true"
        fill
        :has-more="hasMore"
        :loading="loadingMore"
        @load-more="emit('loadMore')"
      >
        <template #default="{ item: t, index: i }">
          <label class="track-row">
            <input
              type="checkbox"
              :checked="selected.has(i)"
              @change="toggleOne(i, ($event.target as HTMLInputElement).checked)"
            />
            <span class="track-title">{{ t.title }}</span>
            <span
              v-if="inLibrary(t)"
              class="lib-badge"
              title="下载记录中已存在同一首歌"
            >已在库</span>
            <span class="muted track-artist">{{ t.artist }}</span>
            <span class="muted track-dur">{{ fmtDur(t.duration) }}</span>
          </label>
        </template>
      </VirtualList>
      <p v-else class="muted empty-tracks">暂无曲目</p>
    </div>

    <div v-if="hasMore || loadingMore" class="more-bar">
      <span class="muted">{{ loadedText }}</span>
      <button class="btn btn-ghost" type="button" :disabled="loadingMore" @click="emit('loadMore')">
        {{ loadingMore ? '补齐中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.album-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 12px;
  overflow-y: auto;
}
.head {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.back-btn {
  margin-bottom: 8px;
  padding: 4px 8px;
  font-size: 13px;
}
.album-meta {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.cover {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--accent-soft);
}
.album-meta h2 {
  margin: 0 0 4px;
  font-size: 1.1rem;
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.field-inline span {
  flex-shrink: 0;
}
.folder-field {
  flex: 1 1 180px;
  min-width: 160px;
}
.folder-field .input {
  flex: 1;
  min-width: 0;
}
.folder-hint {
  flex: 1 1 100%;
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
/* 「加载更多」文字按钮：常驻工具栏，不随长列表滚出视野 */
.more-link {
  flex-shrink: 0;
  padding: 2px 4px;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  border-radius: 4px;
}
.more-link:hover:not(:disabled) {
  background: color-mix(in oklab, var(--accent) 12%, transparent);
}
.more-link:disabled {
  color: var(--muted);
  cursor: default;
  text-decoration: none;
}
.more-done {
  flex-shrink: 0;
  font-size: 12px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.track-list {
  flex: 1 1 auto;
  /* 弹性占满剩余高度，同时兜底最小高度，避免小屏被上方控件挤没 */
  min-height: 400px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  -webkit-overflow-scrolling: touch;
}
.more-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 2px 0;
  font-size: 12px;
}
.more-bar .btn {
  min-width: 96px;
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 8px;
}
.empty-tracks {
  padding: 24px;
  text-align: center;
  margin: 0;
}
.track-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  cursor: pointer;
  box-sizing: border-box;
}
.track-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-badge {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 11px;
  line-height: 1.5;
  border-radius: 4px;
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, transparent);
}
.track-artist,
.track-dur {
  flex-shrink: 0;
  font-size: 12px;
}
@media (max-width: 768px) {
  .album-detail {
    height: auto;
    min-height: 100%;
  }
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .toolbar-actions {
    flex-direction: column;
  }
  .toolbar-actions .btn {
    width: 100%;
  }
  .track-list {
    /* H5：父级常为 height:auto，给列表明确高度供 VirtualList fill；仍保底 400px */
    flex: none;
    height: max(400px, min(55vh, 520px));
    min-height: 400px;
  }
  .track-row {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
  }
  .track-artist {
    grid-column: 2;
  }
  .track-dur {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
