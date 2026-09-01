<script setup lang="ts">
import {
  DOWNLOAD_QUALITY_OPTIONS,
  PLAYLIST_PLATFORM_ORDER,
  platformListText,
  type DownloadQuality,
} from '~/utils/mediaLabels'

type Track = {
  externalId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  platform: string
  musicInfo?: Record<string, any>
  matchMethod?: string
}

type PlaylistPreview = {
  title: string
  platform: string
  tracks: Track[]
  url?: string
}

type MatchRow = {
  index: number
  track: Track
  method: string
  score: number
  needsConfirm: boolean
  selected: {
    externalId?: string
    title: string
    artist: string
    album?: string
    duration?: number
    musicInfo?: Record<string, any>
  } | null
  candidates: Array<{
    externalId?: string
    title: string
    artist: string
    album?: string
    duration?: number
    score: number
    musicInfo?: Record<string, any>
  }>
  error?: string
}

type EnqueueResultPayload = {
  enqueued: number
  total: number
  batchId?: string
  results?: Array<{
    title: string
    ok: boolean
    method?: string
    error?: string
    taskId?: string
  }>
}

const url = ref('')
const loading = ref(false)
const preview = ref<PlaylistPreview | null>(null)
const result = ref<EnqueueResultPayload | null>(null)
const showResult = ref(false)
const selected = ref<Set<number>>(new Set())
const matchRows = ref<MatchRow[]>([])
const showConfirm = ref(false)
const confirmChoices = ref<Record<number, number | 'skip'>>({})
const withLyric = ref(true)
const lyricMode = ref<'external' | 'embedded'>('external')
const quality = ref<DownloadQuality>('highest')
const playlistPlatformHint = computed(() => platformListText(PLAYLIST_PLATFORM_ORDER))
const toast = useToast()
const loadingText = ref('加载中…')
const loadingDetail = ref('')
const loadingPercent = ref<number | null>(null)
const abortControllerRef = ref<AbortController | null>(null)
const cancelText = ref('取消')

async function loadDefaults() {
  const s = await $fetch<{
    downloadLyric: boolean
    lyricMode: 'external' | 'embedded'
    defaultQuality: string
  }>('/api/settings')
  withLyric.value = s.downloadLyric
  lyricMode.value = s.lyricMode || 'external'
  if (DOWNLOAD_QUALITY_OPTIONS.some((o) => o.id === s.defaultQuality)) {
    quality.value = s.defaultQuality as DownloadQuality
  }
}

onMounted(async () => {
  try {
    await loadDefaults()
  } catch {
    /* ignore */
  }
})

useRegisterPageRefresh(async () => {
  await loadDefaults()
})

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => {
  const n = preview.value?.tracks.length || 0
  return n > 0 && selected.value.size === n
})
const confirmPending = computed(() => matchRows.value.filter((r) => r.needsConfirm))

function trackKey(i: number) {
  return i
}

function toggleOne(i: number, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(i)
  else next.delete(i)
  selected.value = next
}

function toggleAll() {
  if (!preview.value) return
  if (allSelected.value) {
    selected.value = new Set()
    return
  }
  selected.value = new Set(preview.value.tracks.map((_, i) => i))
}

function cancelOperation() {
  if (abortControllerRef.value) {
    abortControllerRef.value.abort()
    abortControllerRef.value = null
  }
  loading.value = false
  toast.info('已取消当前操作')
}

async function parseOnly() {
  result.value = null
  matchRows.value = []
  showConfirm.value = false
  loadingText.value = '正在解析歌单…'
  loadingDetail.value = ''
  loadingPercent.value = null
  cancelText.value = '取消解析'
  loading.value = true

  const abortController = new AbortController()
  abortControllerRef.value = abortController

  try {
    const res = await fetchPlaylistParseNdjson(
      { url: url.value },
      {
        signal: abortController.signal,
        onProgress: (ev) => {
          const total = ev.total || 0
          loadingText.value = total > 0 ? `正在解析歌单 (${ev.index}/${total})` : `正在解析歌单 (${ev.index})`
          loadingDetail.value = ev.title ? `曲目：${ev.title}` : ''
          loadingPercent.value = total > 0 ? Math.round((ev.index / total) * 100) : null
        },
      },
    )
    const tracks = (res.tracks || []).map((t: Track) => ({
      ...t,
      musicInfo: t.musicInfo,
      matchMethod: t.matchMethod || (t.musicInfo ? 'parse' : undefined),
    }))
    preview.value = {
      platform: res.platform,
      title: res.title,
      url: res.url || url.value,
      tracks,
    }
    selected.value = new Set(tracks.map((_, i) => i))
    toast.success(`解析成功：${res.title}，共 ${tracks.length} 首（已全选）`)
  } catch (e: unknown) {
    const err = e as { name?: string }
    if (err?.name === 'AbortError' || abortController.signal.aborted) {
      return
    }
    toast.error(apiErrorMessage(e, '解析失败'))
    preview.value = null
    selected.value = new Set()
  } finally {
    if (abortControllerRef.value === abortController) {
      abortControllerRef.value = null
    }
    loading.value = false
  }
}
async function enqueueAll() {
  loadingText.value = '解析并入队中…'
  loadingDetail.value = ''
  loadingPercent.value = null
  cancelText.value = '取消下载'
  loading.value = true

  const abortController = new AbortController()
  abortControllerRef.value = abortController

  try {
    const res = await fetchPlaylistEnqueueNdjson(
      {
        url: url.value,
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        quality: quality.value,
        concurrency: 8,
      },
      {
        signal: abortController.signal,
        onStart: (total, stage) => {
          if (stage === 'matching') {
            loadingText.value = `正在匹配并入队 (0/${total})`
            loadingPercent.value = 0
          } else {
            loadingText.value = '正在解析歌单…'
            loadingPercent.value = null
          }
        },
        onParseProgress: (ev) => {
          const total = ev.total || 0
          loadingText.value = total > 0 ? `正在解析歌单 (${ev.index}/${total})` : `正在解析歌单 (${ev.index})`
          loadingDetail.value = ev.title ? `曲目：${ev.title}` : ''
          loadingPercent.value = total > 0 ? Math.round((ev.index / total) * 100) : null
        },
        onProgress: (ev) => {
          const statusStr = ev.ok === false ? ' [未匹配]' : ''
          loadingText.value = `正在匹配并入队 (${ev.index}/${ev.total})`
          loadingDetail.value = `${ev.title}${statusStr}`
          loadingPercent.value = ev.total > 0 ? Math.round((ev.index / ev.total) * 100) : null
        },
      },
    )
    openEnqueueResult(res)
  } catch (e: unknown) {
    const err = e as { name?: string }
    if (err?.name === 'AbortError' || abortController.signal.aborted) {
      return
    }
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    if (abortControllerRef.value === abortController) {
      abortControllerRef.value = null
    }
    loading.value = false
  }
}
async function prepareSelectedDownload() {
  if (!preview.value || !selected.value.size) return
  const rawTracks = preview.value.tracks.filter((_, i) => selected.value.has(i))
  // 深拷贝原始曲目并清除之前的匹配状态，杜绝污染或残留状态
  const tracks: Track[] = rawTracks.map((t) => ({
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    platform: t.platform,
    externalId: t.externalId,
  }))

  matchRows.value = []
  confirmChoices.value = {}
  loadingText.value = `正在匹配曲目 (0/${tracks.length})`
  loadingDetail.value = ''
  loadingPercent.value = 0
  cancelText.value = '取消匹配'
  loading.value = true

  const abortController = new AbortController()
  abortControllerRef.value = abortController

  try {
    let doneCount = 0
    const res = await fetchPlaylistMatchNdjson(
      { tracks, concurrency: 8, allowManualBypass: false },
      {
        signal: abortController.signal,
        onStart: (total) => {
          loadingText.value = `正在匹配曲目 (0/${total})`
          loadingPercent.value = 0
        },
        onProgress: (ev) => {
          doneCount++
          loadingText.value = `正在匹配曲目 (${doneCount}/${ev.total})`
          loadingDetail.value = `${ev.track.title} - ${ev.track.artist || '未知歌手'}`
          loadingPercent.value = ev.total > 0 ? Math.round((doneCount / ev.total) * 100) : 0
        },
      },
    )
    matchRows.value = res.rows as MatchRow[]
    const choices: Record<number, number | 'skip'> = {}
    for (const row of res.rows as MatchRow[]) {
      if (row.needsConfirm) {
        choices[row.index] = row.selected ? 0 : 'skip'
      }
    }
    confirmChoices.value = choices
    if (res.needConfirm > 0) {
      showConfirm.value = true
      toast.warning(`需确认 ${res.needConfirm} 首低分/未命中匹配（自动通过 ${res.autoOk}）`)
    } else {
      await enqueueMatched(res.rows as MatchRow[])
    }
  } catch (e: unknown) {
    const err = e as { name?: string }
    if (err?.name === 'AbortError' || abortController.signal.aborted) {
      // 用户主动取消，不报 error toast
      return
    }
    toast.error(apiErrorMessage(e, '匹配失败'))
  } finally {
    if (abortControllerRef.value === abortController) {
      abortControllerRef.value = null
    }
    loading.value = false
  }
}

function buildResolvedTracks(rows: MatchRow[]): Track[] {
  const out: Track[] = []
  for (const row of rows) {
    if (!row.needsConfirm) {
      if (!row.selected) continue
      out.push({
        ...row.track,
        title: row.selected.title,
        artist: row.selected.artist,
        album: row.selected.album,
        duration: row.selected.duration,
        externalId: row.selected.externalId,
        musicInfo: row.selected.musicInfo,
        matchMethod: row.method,
      })
      continue
    }
    const raw = confirmChoices.value[row.index]
    if (raw === 'skip' || raw == null) continue
    const cand = row.candidates[raw]
    if (!cand) continue
    out.push({
      ...row.track,
      title: cand.title,
      artist: cand.artist,
      album: cand.album,
      duration: cand.duration,
      externalId: cand.externalId,
      musicInfo: cand.musicInfo,
      matchMethod: 'manual',
    })
  }
  return out
}

async function enqueueMatched(rows: MatchRow[]) {
  if (!preview.value) return
  const tracks = buildResolvedTracks(rows)
  if (!tracks.length) {
    toast.warning('没有可入队的曲目')
    return
  }
  loadingText.value = '入队中…'
  loading.value = true
  try {
    const res = await $fetch<EnqueueResultPayload>('/api/playlist/enqueue', {
      method: 'POST',
      body: {
        url: preview.value.url || url.value,
        title: preview.value.title,
        platform: preview.value.platform,
        tracks,
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        quality: quality.value,
      },
    })
    showConfirm.value = false
    openEnqueueResult(res)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    loading.value = false
  }
}
function openEnqueueResult(res: EnqueueResultPayload) {
  result.value = res
  showResult.value = true
  if (res.enqueued > 0) {
    toast.success(`成功入队 ${res.enqueued} 首`)
  } else {
    toast.warning('未能入队任何曲目')
  }
}
async function retryFailedEnqueue(failedItems: Array<{ title: string; ok: boolean; error?: string }>) {
  if (!preview.value || !failedItems.length) return
  const failedTitles = new Set(failedItems.map((f) => f.title.trim()))
  const failedIndices: number[] = []
  preview.value.tracks.forEach((t, i) => {
    if (failedTitles.has(t.title.trim())) {
      failedIndices.push(i)
    }
  })
  if (!failedIndices.length) {
    toast.warning('未能在当前歌单中找到对应失败曲目')
    return
  }
  selected.value = new Set(failedIndices)
  toast.info(`已选中 ${failedIndices.length} 首失败曲目，准备重试匹配…`)
  await prepareSelectedDownload()
}

async function confirmAndEnqueue() {
  await enqueueMatched(matchRows.value)
}
</script>

<template>
  <div class="page page-playlist">
    <PageLoading
      :show="loading"
      :text="loadingText"
      :detail="loadingDetail"
      :percent="loadingPercent"
      :cancelable="Boolean(abortControllerRef)"
      :cancel-text="cancelText"
      @cancel="cancelOperation"
    />
    <div class="row">
      <input
        v-model="url"
        class="input"
        :placeholder="`${playlistPlatformHint} 歌单链接`"
      />
      <button class="btn btn-ghost" type="button" :disabled="loading || !url.trim()" @click="parseOnly">
        仅解析
      </button>
      <button class="btn" type="button" :disabled="loading || !url.trim()" @click="enqueueAll">
        解析并全部下载
      </button>
    </div>
    <div class="lyric-opts">
      <label class="field-inline">
        <span>音质</span>
        <select v-model="quality" class="select">
          <option v-for="opt in DOWNLOAD_QUALITY_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="check">
        <input v-model="withLyric" type="checkbox" />
        下载歌词
      </label>
      <label v-if="withLyric" class="field-inline">
        <span>写入方式</span>
        <select v-model="lyricMode" class="select">
          <option value="external">仅外部 .lrc</option>
          <option value="embedded">仅内嵌到音频</option>
        </select>
      </label>
    </div>

    <div v-if="preview" class="card" style="margin-top: 16px">
      <div class="preview-head">
        <div>
          <h3>{{ preview.title }}</h3>
          <p class="muted">
            {{ preview.platform }} · 共 {{ preview.tracks.length }} 首 · 已选 {{ selectedCount }}
          </p>
        </div>
        <div class="actions">
          <button class="btn btn-ghost" type="button" @click="toggleAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="loading || !selectedCount"
            @click="prepareSelectedDownload"
          >
            下载选中（{{ selectedCount }}）
          </button>
        </div>
      </div>

      <VirtualList
        v-if="preview.tracks.length"
        :items="preview.tracks"
        :estimate-size="72"
        :dynamic="true"
        max-height="420px"
      >
        <template #default="{ item, index }">
          <label class="track-row">
            <input
              type="checkbox"
              :checked="selected.has(trackKey(index))"
              @change="toggleOne(index, ($event.target as HTMLInputElement).checked)"
            />
            <span class="track-meta">
              <span class="track-title">{{ item.title }}</span>
              <span class="track-artist">
                {{ item.artist || '未知歌手' }}<template v-if="item.album"> · {{ item.album }}</template>
              </span>
            </span>
          </label>
        </template>
      </VirtualList>
    </div>

    <MatchConfirmDialog
      v-model:open="showConfirm"
      v-model:choices="confirmChoices"
      :rows="confirmPending"
      :loading="loading"
      @confirm="confirmAndEnqueue"
    />

    <EnqueueResultDialog
      v-model:open="showResult"
      :result="result"
      @retry-failed="retryFailedEnqueue"
    />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.lyric-opts {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.lyric-opts .check {
  display: flex;
  align-items: center;
  gap: 6px;
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
.row .input {
  flex: 1;
  min-width: 240px;
}
.ok {
  color: var(--accent);
}
.err {
  color: var(--danger);
}
.preview-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.preview-head h3 {
  margin: 0 0 4px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.track-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 4px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}
.track-row input {
  margin-top: 2px;
  flex-shrink: 0;
}
.track-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.track-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 560;
  font-size: 14px;
  line-height: 1.35;
  color: var(--text);
}
.track-artist {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.35;
  color: var(--muted);
}

@media (max-width: 768px) {
  .row {
    flex-direction: column;
  }
  .row .input {
    min-width: 0;
    width: 100%;
  }
  .row .btn {
    width: 100%;
  }
  .lyric-opts {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .field-inline {
    flex-direction: column;
    align-items: stretch;
  }
  .preview-head {
    flex-direction: column;
  }
  .actions .btn {
    flex: 1;
    min-width: 0;
  }
  .track-row {
    padding: 16px 6px;
    gap: 14px;
    min-height: 64px;
  }
  .track-row input {
    margin-top: 4px;
    width: 20px;
    height: 20px;
  }
  .track-meta {
    gap: 6px;
  }
  .track-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 15px;
    line-height: 1.4;
  }
  .track-artist {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 13px;
    line-height: 1.4;
    /* 比桌面 muted 更亮，避免暗色主题下几乎看不见 */
    color: color-mix(in oklab, var(--text) 55%, var(--muted));
    opacity: 1;
  }
}
</style>
