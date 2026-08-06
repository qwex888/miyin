<script setup lang="ts">
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
const platforms = ref<Array<{ id: string; label: string; sourceCount: number }>>([
  { id: 'wy', label: '网易云', sourceCount: 0 },
  { id: 'kw', label: '酷我', sourceCount: 0 },
  { id: 'kg', label: '酷狗', sourceCount: 0 },
  { id: 'tx', label: 'QQ', sourceCount: 0 },
])
const items = ref<Track[]>([])
const selected = ref<Track | null>(null)
const loading = ref(false)
const error = ref('')
const quality = ref('highest')
const withLyric = ref(true)
const lyricMode = ref<'external' | 'embedded'>('external')
const msg = ref('')
const { play, current, toggle } = usePlayer()

async function loadLyricDefaults() {
  try {
    const s = await $fetch<{ downloadLyric: boolean; lyricMode: 'external' | 'embedded' }>('/api/settings')
    withLyric.value = s.downloadLyric
    lyricMode.value = s.lyricMode || 'external'
  } catch {
    /* ignore */
  }
}

onMounted(loadLyricDefaults)

async function doSearch() {
  if (!keyword.value.trim()) return
  loading.value = true
  error.value = ''
  msg.value = ''
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
      msg.value = '提示：当前平台没有可用音源，试听/下载前请先到「音源管理」导入'
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '搜索失败'
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
  msg.value = ''
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
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '试听失败'
  }
}

async function download() {
  if (!selected.value) return
  msg.value = ''
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
    msg.value = '已加入下载队列'
    useDownloadBadge().notifyChanged()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '入队失败'
  }
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="page">
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

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="msg" class="tip">{{ msg }}</p>

    <div class="split">
      <div class="card list">
        <div
          v-for="t in items"
          :key="t.id"
          class="row"
          :class="{ active: selected?.id === t.id }"
          @click="selected = t"
        >
          <CoverImage :src="t.cover" class="cover" :alt="t.title" />
          <div class="meta">
            <div class="title">{{ t.title }}</div>
            <div class="muted">{{ t.artist }} · {{ fmtDur(t.duration) }}</div>
          </div>
        </div>
        <p v-if="!items.length" class="muted empty">暂无结果，输入关键词搜索</p>
      </div>

      <div class="card detail">
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

    <div v-if="current" class="mini">
      <span>▶ {{ current.title }} - {{ current.artist }}</span>
      <button class="btn btn-ghost" type="button" @click="toggle">播放/暂停</button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
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
  min-height: 420px;
}
@media (max-width: 860px) {
  .split {
    grid-template-columns: 1fr;
  }
}
.list {
  padding: 8px;
  max-height: 560px;
  overflow: auto;
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
  background: #ecfdf5;
}
.detail-cover {
  width: 100%;
  height: 180px;
  margin-bottom: 8px;
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
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}
</style>
