<script setup lang="ts">
import { SEARCH_PLATFORM_ORDER, platformLabel } from '~/utils/mediaLabels'

type Track = {
  id: string
  externalId: string
  title: string
  artist: string
  album: string
  duration: number
  platform: string
  cover?: string
  qualitys: string[]
  musicInfo: Record<string, any>
}

const keyword = ref('')
const platform = ref('wy')
const platforms = ref<Array<{ id: string; label: string; sourceCount: number }>>(
  SEARCH_PLATFORM_ORDER.map((id) => ({ id, label: platformLabel(id), sourceCount: 0 })),
)
const items = ref<Track[]>([])
const selected = ref<Track | null>(null)
const loading = ref(false)
const quality = ref('highest')
const withLyric = ref(true)
const lyricMode = ref<'external' | 'embedded'>('external')
const { play, current, playing, toggle, stop } = usePlayer()
const toast = useToast()
const detailSheetOpen = ref(false)
const downloading = ref(false)
const {
  showHomeBanner,
  refresh: refreshFnOsAuth,
  dismissBanner,
} = useFnOsDirAuth()
const route = useRoute()
/** KeepAlive + Teleport：离开首页时不得继续盖住其它页 */
const showFnOsAuthDialog = computed(() => showHomeBanner.value && route.path === '/')

function selectTrack(t: Track) {
  selected.value = t
  if (import.meta.client && window.matchMedia('(max-width: 768px)').matches) {
    detailSheetOpen.value = true
  }
}

function closeDetailSheet() {
  detailSheetOpen.value = false
}

function onDetailKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && detailSheetOpen.value) closeDetailSheet()
}

async function loadLyricDefaults() {
  try {
    const s = await $fetch<{
      downloadLyric: boolean
      lyricMode: 'external' | 'embedded'
      defaultQuality: string
    }>('/api/settings')
    withLyric.value = s.downloadLyric
    lyricMode.value = s.lyricMode || 'external'
    if (['highest', 'flac24bit', 'flac', '320k', '128k'].includes(s.defaultQuality)) {
      quality.value = s.defaultQuality
    }
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  loadLyricDefaults()
  void refreshFnOsAuth()
  window.addEventListener('keydown', onDetailKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDetailKeydown)
})

useRegisterPageRefresh(async () => {
  await loadLyricDefaults()
  await refreshFnOsAuth()
})

function goFnOsAuthorize() {
  // 与「稍后提醒」一样记一次关闭，避免 Teleport 遮罩带到设置页
  dismissBanner()
  void navigateTo('/settings?fnosAuth=1')
}

async function doSearch() {
  if (!keyword.value.trim()) return
  loading.value = true
  try {
    const res = await $fetch<{
      items: Track[]
      platforms: Array<{ id: string; label: string; sourceCount: number }>
      sourceHint: string[]
    }>('/api/search', {
      method: 'POST',
      body: { platform: platform.value, keyword: keyword.value, page: 1 },
    })
    items.value = res.items
    if (res.platforms?.length) platforms.value = res.platforms
    selected.value = res.items[0] || null
    if (!res.sourceHint?.length) {
      toast.warning('当前平台没有可用音源，试听/下载前请先到「音源管理」导入')
    } else if (!res.items.length) {
      toast.info('未找到相关歌曲')
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '搜索失败'))
    items.value = []
    selected.value = null
  } finally {
    loading.value = false
  }
}

watch(platform, () => {
  if (keyword.value.trim()) void doSearch()
})

async function preview() {
  if (!selected.value) return
  try {
    const res = await $fetch<{ url: string; quality: string }>('/api/preview', {
      method: 'POST',
      body: {
        platform: selected.value.platform,
        musicInfo: selected.value.musicInfo,
        quality: quality.value,
      },
    })
    await play({
      title: selected.value.title,
      artist: selected.value.artist,
      url: res.url,
    })
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '试听失败'))
  }
}

async function download() {
  if (!selected.value || downloading.value) return
  downloading.value = true
  try {
    await $fetch('/api/downloads', {
      method: 'POST',
      body: {
        title: selected.value.title,
        artist: selected.value.artist,
        album: selected.value.album,
        platform: selected.value.platform,
        quality: quality.value,
        musicInfo: selected.value.musicInfo,
        externalId: selected.value.externalId,
        matchMethod: 'id',
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
      },
    })
    toast.success('已加入下载队列')
    useDownloadBadge().notifyChanged()
    if (detailSheetOpen.value) {
      await new Promise((r) => setTimeout(r, 350))
      closeDetailSheet()
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    downloading.value = false
  }
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="page page-home">
    <PageLoading :show="loading" text="搜索中…" />
    <FnOsDirAuthDialog
      :open="showFnOsAuthDialog"
      @authorize="goFnOsAuthorize"
      @dismiss="dismissBanner()"
    />
    <div class="search-bar">
      <input
        v-model="keyword"
        class="input"
        placeholder="搜索歌曲 / 歌手"
        @keyup.enter="doSearch"
      />
      <button class="btn" type="button" :disabled="loading" @click="doSearch">
        {{ loading ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <div class="tabs">
      <button
        v-for="p in platforms"
        :key="p.id"
        type="button"
        class="tab"
        :class="{ active: platform === p.id }"
        @click="platform = p.id"
      >
        {{ p.label }}
        <span class="muted">({{ p.sourceCount }})</span>
      </button>
    </div>

    <div class="split">
      <div class="card list">
        <div
          v-for="t in items"
          :key="t.id"
          class="row"
          :class="{ active: selected?.id === t.id }"
          @click="selectTrack(t)"
        >
          <CoverImage :src="t.cover" class="cover" :alt="t.title" />
          <div class="meta">
            <div class="title">{{ t.title }}</div>
            <div class="muted">{{ t.artist }} · {{ fmtDur(t.duration) }}</div>
          </div>
        </div>
        <p v-if="!items.length" class="muted empty">暂无结果，输入关键词搜索</p>
      </div>

      <!-- 桌面：侧栏详情（移动端用 CSS 隐藏，避免 SSR 闪烁） -->
      <div class="card detail desktop-only">
        <template v-if="selected">
          <CoverImage :src="selected.cover" class="detail-cover" :alt="selected.title" :lazy="false" />
          <h2>{{ selected.title }}</h2>
          <p class="muted">{{ selected.artist }}</p>
          <p class="muted">专辑：{{ selected.album || '—' }}</p>
          <p class="muted">平台：{{ selected.platform }} · ID：{{ selected.externalId }}</p>

          <label class="field">
            <span>音质</span>
            <select v-model="quality" class="select">
              <option value="highest">最高可用</option>
              <option value="flac24bit">flac24bit</option>
              <option value="flac">flac</option>
              <option value="320k">320k</option>
              <option value="128k">128k</option>
            </select>
          </label>
          <label class="check">
            <input v-model="withLyric" type="checkbox" />
            同时下载歌词
          </label>
          <label v-if="withLyric" class="field">
            <span>歌词写入</span>
            <select v-model="lyricMode" class="select">
              <option value="external">仅外部 .lrc</option>
              <option value="embedded">仅内嵌到音频</option>
            </select>
          </label>
          <div class="actions">
            <button class="btn btn-ghost" type="button" @click="preview">试听</button>
            <button class="btn" type="button" @click="download">下载</button>
          </div>
        </template>
        <p v-else class="muted">选择左侧歌曲查看详情</p>
      </div>
    </div>

    <!-- 移动端：底部抽屉详情 -->
    <Teleport to="body">
      <div
        v-if="detailSheetOpen && selected"
        class="detail-sheet-overlay"
        @click.self="closeDetailSheet"
      >
        <div class="detail-sheet card" role="dialog" aria-modal="true" :aria-label="selected.title">
          <div class="sheet-handle" aria-hidden="true" />
          <div class="sheet-head">
            <h2 class="sheet-title">{{ selected.title }}</h2>
            <button class="icon-close" type="button" aria-label="关闭" @click="closeDetailSheet">×</button>
          </div>
          <div class="sheet-body">
            <CoverImage :src="selected.cover" class="detail-cover" :alt="selected.title" :lazy="false" />
            <p class="artist-line">{{ selected.artist }}</p>
            <p class="meta-line">专辑：{{ selected.album || '—' }}</p>
            <p class="meta-line">平台：{{ selected.platform }} · ID：{{ selected.externalId }}</p>

            <label class="field">
              <span>音质</span>
              <select v-model="quality" class="select">
                <option value="highest">最高可用</option>
                <option value="flac24bit">flac24bit</option>
                <option value="flac">flac</option>
                <option value="320k">320k</option>
                <option value="128k">128k</option>
              </select>
            </label>
            <label class="check">
              <input v-model="withLyric" type="checkbox" />
              同时下载歌词
            </label>
            <label v-if="withLyric" class="field">
              <span>歌词写入</span>
              <select v-model="lyricMode" class="select">
                <option value="external">仅外部 .lrc</option>
                <option value="embedded">仅内嵌到音频</option>
              </select>
            </label>
            <div class="actions">
              <button class="btn btn-ghost" type="button" @click="preview">试听</button>
              <button class="btn" type="button" :disabled="downloading" @click="download">
                {{ downloading ? '入队中…' : '下载' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <div v-if="current" class="mini">
      <span class="mini-title">{{ current.title }} - {{ current.artist }}</span>
      <div class="mini-actions">
        <button
          class="mini-icon-btn"
          type="button"
          :aria-label="playing ? '暂停' : '播放'"
          @click="toggle"
        >
          <!-- 播放中显示暂停；已暂停显示播放 -->
          <svg v-if="playing" class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
          <svg v-else class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
          </svg>
        </button>
        <button class="mini-icon-btn" type="button" aria-label="关闭试听" @click="stop">
          <svg class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6.4 6.4a1 1 0 0 1 1.4 0L12 10.6l4.2-4.2a1 1 0 1 1 1.4 1.4L13.4 12l4.2 4.2a1 1 0 0 1-1.4 1.4L12 13.4l-4.2 4.2a1 1 0 0 1-1.4-1.4L10.6 12 6.4 7.8a1 1 0 0 1 0-1.4z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  padding-bottom: 16px;
  box-sizing: border-box;
}
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.search-bar .input {
  flex: 1;
}
.search-bar .btn {
  min-width: 100px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  flex-shrink: 0;
}
.tab {
  border: none;
  background: transparent;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--muted);
}
.tab.active {
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
  font-weight: 600;
}
.split {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }
  .search-bar {
    padding-top: 8px;
    flex-direction: column;
  }
  .search-bar .btn {
    width: 100%;
    min-width: 0;
  }
  .tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    gap: 4px;
  }
  .tab {
    flex-shrink: 0;
    min-height: 40px;
    padding: 8px 12px;
  }
  .split {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .actions {
    flex-direction: column;
  }
  .actions .btn {
    width: 100%;
  }
  .mini {
    bottom: calc(64px + env(safe-area-inset-bottom, 0px));
    left: 10px;
    right: 10px;
    gap: 8px;
    font-size: 13px;
  }
}

@media (max-width: 860px) and (min-width: 769px) {
  .split {
    grid-template-columns: 1fr;
  }
}

.list {
  padding: 8px;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.row {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
}
.row:hover,
.row.active {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}
.cover,
.detail-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--accent-soft);
}
.detail-cover {
  width: 100%;
  height: 180px;
  margin-bottom: 8px;
}
.detail {
  min-height: 0;
  overflow: auto;
}
.title {
  font-weight: 600;
}
.detail h2 {
  margin: 0 0 4px;
}
.field {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
.err {
  color: var(--danger);
}
.tip {
  color: var(--accent);
}
.empty {
  padding: 24px;
  text-align: center;
}
.mini {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 35;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  box-shadow: var(--shadow);
}
.mini-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.mini-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.mini-icon-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.mini-ico {
  width: 18px;
  height: 18px;
  display: block;
}

.detail-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  background: color-mix(in oklab, #0f172a 45%, transparent);
  backdrop-filter: blur(2px);
}
@media (min-width: 769px) {
  .detail-sheet-overlay {
    display: none !important;
  }
}
.detail-sheet {
  width: 100%;
  max-height: min(82dvh, 720px);
  border-radius: 16px 16px 0 0;
  padding: 8px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-shadow: var(--shadow);
  animation: sheet-up 0.22s ease-out;
}
@keyframes sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--border);
  margin: 4px auto 10px;
  flex-shrink: 0;
}
.sheet-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 8px;
}
.sheet-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 1.15rem;
  line-height: 1.3;
}
.icon-close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.sheet-body {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding-bottom: 8px;
}
.sheet-body .detail-cover {
  height: 160px;
}
.artist-line {
  margin: 0 0 4px;
  color: var(--text);
  opacity: 0.85;
  font-size: 14px;
}
.meta-line {
  margin: 0 0 2px;
  color: var(--muted);
  font-size: 13px;
}
.sheet-feedback {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--accent);
}
.sheet-feedback.err {
  color: var(--danger);
}
</style>
