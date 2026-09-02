<script setup lang="ts">
import {
  DOWNLOAD_QUALITY_OPTIONS,
  type DownloadQuality,
} from '~/utils/mediaLabels'

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
    /** 全屏详情（H5）显示返回；PC 侧栏内嵌时可关闭 */
    showBack?: boolean
  }>(),
  {
    loading: false,
    showBack: true,
  },
)

const emit = defineEmits<{
  back: []
  enqueue: [indices: number[]]
  'update:quality': [v: DownloadQuality]
  'update:withLyric': [v: boolean]
  'update:lyricMode': [v: 'external' | 'embedded']
}>()

const selected = ref<Set<number>>(new Set())

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

function enqueueAll() {
  selected.value = new Set(props.detail.tracks.map((_, i) => i))
  enqueueSelected()
}
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
          <p v-if="detail.album.trackCount" class="muted">{{ detail.album.trackCount }} 首 · {{ detail.album.platform }}</p>
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
    </div>

    <div class="toolbar">
      <label class="check">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        全选（已选 {{ selected.size }} / {{ detail.tracks.length }}）
      </label>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" type="button" :disabled="!selected.size || loading" @click="enqueueSelected">
          下载选中
        </button>
        <button class="btn" type="button" :disabled="!detail.tracks.length || loading" @click="enqueueAll">
          {{ loading ? '入队中…' : '一键整专' }}
        </button>
      </div>
    </div>

    <div class="track-list">
      <label v-for="(t, i) in detail.tracks" :key="t.externalId + i" class="track-row">
        <input type="checkbox" :checked="selected.has(i)" @change="toggleOne(i, ($event.target as HTMLInputElement).checked)" />
        <span class="track-title">{{ t.title }}</span>
        <span class="muted track-artist">{{ t.artist }}</span>
        <span class="muted track-dur">{{ fmtDur(t.duration) }}</span>
      </label>
      <p v-if="!detail.tracks.length" class="muted empty-tracks">暂无曲目</p>
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
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.track-list {
  flex: 1 1 auto;
  min-height: 400px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  -webkit-overflow-scrolling: touch;
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
}
.track-row:last-child {
  border-bottom: 0;
}
.track-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
    /* 避免被上方选项挤没：至少 400px，内部可滚 */
    flex: none;
    min-height: 400px;
    max-height: min(55vh, 520px);
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
