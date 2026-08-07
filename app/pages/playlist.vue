<script setup lang="ts">
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

const url = ref('')
const loading = ref(false)
const preview = ref<PlaylistPreview | null>(null)
const result = ref<any>(null)
const selected = ref<Set<number>>(new Set())
const matchRows = ref<MatchRow[]>([])
const showConfirm = ref(false)
const confirmChoices = ref<Record<number, number | 'skip'>>({})
const withLyric = ref(true)
const lyricMode = ref<'external' | 'embedded'>('external')
const toast = useToast()
const loadingText = ref('加载中…')

onMounted(async () => {
  try {
    const s = await $fetch<{ downloadLyric: boolean; lyricMode: 'external' | 'embedded' }>('/api/settings')
    withLyric.value = s.downloadLyric
    lyricMode.value = s.lyricMode || 'external'
  } catch {
    /* ignore */
  }
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

async function parseOnly() {
  result.value = null
  matchRows.value = []
  showConfirm.value = false
  loadingText.value = '解析歌单中…'
  loading.value = true
  try {
    const res = await $fetch<PlaylistPreview>('/api/playlist/parse', {
      method: 'POST',
      body: { url: url.value },
    })
    preview.value = { ...res, url: url.value }
    selected.value = new Set(res.tracks.map((_, i) => i))
    toast.success(`解析成功：${res.title}，共 ${res.tracks.length} 首（已全选）`)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '解析失败'))
    preview.value = null
    selected.value = new Set()
  } finally {
    loading.value = false
  }
}

async function enqueueAll() {
  loadingText.value = '解析并入队中…'
  loading.value = true
  try {
    const res = await $fetch<{ enqueued: number; total: number; batchId: string }>('/api/playlist/enqueue', {
      method: 'POST',
      body: { url: url.value, downloadLyric: withLyric.value, lyricMode: lyricMode.value, quality: 'highest' },
    })
    result.value = res
    toast.success(`已入队 ${res.enqueued}/${res.total}`)
    useDownloadBadge().notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    loading.value = false
  }
}

async function prepareSelectedDownload() {
  if (!preview.value || !selected.value.size) return
  loadingText.value = '匹配曲目中…'
  loading.value = true
  try {
    const tracks = preview.value.tracks.filter((_, i) => selected.value.has(i))
    const res = await $fetch<{ rows: MatchRow[]; needConfirm: number; autoOk: number }>(
      '/api/playlist/match',
      { method: 'POST', body: { tracks } },
    )
    matchRows.value = res.rows
    const choices: Record<number, number | 'skip'> = {}
    for (const row of res.rows) {
      if (row.needsConfirm) {
        choices[row.index] = row.selected ? 0 : 'skip'
      }
    }
    confirmChoices.value = choices
    if (res.needConfirm > 0) {
      showConfirm.value = true
      toast.warning(`需确认 ${res.needConfirm} 首低分/未命中匹配（自动通过 ${res.autoOk}）`)
    } else {
      await enqueueMatched(res.rows)
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '匹配失败'))
  } finally {
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
    const choice = confirmChoices.value[row.index]
    if (choice === 'skip' || choice == null) continue
    const cand = row.candidates[choice]
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
    const res = await $fetch<{ enqueued: number; total: number; batchId: string }>('/api/playlist/enqueue', {
      method: 'POST',
      body: {
        url: preview.value.url || url.value,
        title: preview.value.title,
        platform: preview.value.platform,
        tracks,
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        quality: 'highest',
      },
    })
    result.value = res
    showConfirm.value = false
    toast.success(`已入队 ${res.enqueued}/${res.total}`)
    useDownloadBadge().notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    loading.value = false
  }
}

async function confirmAndEnqueue() {
  await enqueueMatched(matchRows.value)
}
</script>

<template>
  <div class="page">
    <PageLoading :show="loading" :text="loadingText" />
    <h2>歌单导入</h2>
    <p class="muted">
      支持网易云 / QQ / 酷狗歌单链接。解析后可多选；低分匹配会弹出人工确认。
    </p>
    <div class="row">
      <input
        v-model="url"
        class="input"
        placeholder="网易云 / QQ / 酷狗歌单链接"
      />
      <button class="btn btn-ghost" type="button" :disabled="loading || !url.trim()" @click="parseOnly">
        仅解析
      </button>
      <button class="btn" type="button" :disabled="loading || !url.trim()" @click="enqueueAll">
        解析并全部下载
      </button>
    </div>
    <div class="lyric-opts">
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

    <div v-if="showConfirm" class="card confirm-card">
      <h3>匹配确认（{{ confirmPending.length }}）</h3>
      <p class="muted">以下曲目匹配分较低或未命中，请选择候选项或跳过。</p>
      <div v-for="row in confirmPending" :key="row.index" class="confirm-item">
        <div class="confirm-title">
          <strong>{{ row.track.title }}</strong>
          <span class="muted"> · {{ row.track.artist }}</span>
          <span class="muted"> · 分 {{ row.score.toFixed(2) }}</span>
          <span v-if="row.error" class="err"> · {{ row.error }}</span>
        </div>
        <label class="choice">
          <input v-model="confirmChoices[row.index]" type="radio" value="skip" />
          跳过
        </label>
        <label v-for="(c, ci) in row.candidates" :key="ci" class="choice">
          <input v-model="confirmChoices[row.index]" type="radio" :value="ci" />
          {{ c.title }} · {{ c.artist }}
          <span class="muted">({{ c.score.toFixed(2) }})</span>
        </label>
        <p v-if="!row.candidates.length" class="muted">无候选，只能跳过</p>
      </div>
      <div class="actions" style="margin-top: 12px">
        <button class="btn" type="button" :disabled="loading" @click="confirmAndEnqueue">确认并入队</button>
        <button class="btn btn-ghost" type="button" @click="showConfirm = false">取消</button>
      </div>
    </div>

    <div v-if="result" class="card" style="margin-top: 16px">
      <h3>入队结果</h3>
      <p>成功 {{ result.enqueued }} / {{ result.total }}</p>
      <VirtualList :items="result.results" :estimate-size="36" max-height="280px">
        <template #default="{ item }">
          <div class="result-row">
            <span :class="item.ok ? 'ok' : 'err'">{{ item.ok ? '✓' : '✗' }}</span>
            {{ item.title }}
            <span v-if="item.method" class="muted">（{{ item.method }}）</span>
            <span v-if="item.error" class="err">{{ item.error }}</span>
          </div>
        </template>
      </VirtualList>
      <NuxtLink to="/queue" class="btn" style="margin-top: 12px; display: inline-flex">查看队列</NuxtLink>
    </div>
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
.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 0 4px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.confirm-card {
  margin-top: 16px;
}
.confirm-item {
  border-top: 1px solid var(--border);
  padding: 10px 0;
}
.confirm-title {
  margin-bottom: 6px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 13px;
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
  .choice {
    min-height: 40px;
  }
}
</style>
