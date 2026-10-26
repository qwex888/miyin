<script setup lang="ts">
import {
  DOWNLOAD_QUALITY_OPTIONS,
  SEARCH_PLATFORM_ORDER,
  platformLabel,
  type DownloadQuality,
} from '~/utils/mediaLabels'
import { SEARCH_PAGE_SIZE, searchPageHasMore } from '#shared/searchPagination'
import { buildDedupKey } from '#shared/trackKey'
import type { EnqueueResultPayload } from '~/components/EnqueueResultDialog.vue'
import type { AlbumDetailData } from '~/components/AlbumDetailPanel.vue'
import type { SearchAlbumItem } from '~/components/AlbumResultList.vue'
import type { SearchTrack } from '~/components/SongResultList.vue'
import { fetchAlbumEnqueueAllNdjson } from '~/utils/fetchPlaylistMatchNdjson'
import type {
  DuplicateDecision,
  DuplicateReviewItem,
} from '~/components/DuplicateReviewDialog.vue'

/** `/api/album/detail` 分页响应（Issue #40：详情只加载一页，整专下载另走流式接口） */
type AlbumPageData = AlbumDetailData & {
  hasMore: boolean
  total?: number
  nextCursor: number
}

type PlatformTab = {
  id: string
  label: string
  sourceCount: number
  albumCapable?: boolean
}

const keyword = ref('')
const searchType = ref<'song' | 'album'>('song')
const view = ref<'results' | 'albumDetail'>('results')
const platform = ref('wy')
const platforms = ref<PlatformTab[]>(
  SEARCH_PLATFORM_ORDER.map((id) => ({ id, label: platformLabel(id), sourceCount: 0 })),
)
const items = ref<SearchTrack[]>([])
const albumItems = ref<SearchAlbumItem[]>([])
const selected = ref<SearchTrack | null>(null)
const selectedAlbum = ref<SearchAlbumItem | null>(null)
const albumDetail = ref<AlbumDetailData | null>(null)
/** 专辑详情分页状态（Issue #40）：只加载已翻到的页，未加载部分交给「整专下载」处理 */
const albumCursor = ref(0)
const albumHasMore = ref(false)
const albumLoadingMore = ref(false)
const albumTotal = ref<number | null>(null)
/** 递增以作废过期的专辑分页响应（切专辑 / 换平台 / 重开详情） */
let albumGen = 0
const loading = ref(false)
const loadingMore = ref(false)
const loadingText = ref('搜索中…')
const currentPage = ref(1)
const hasMore = ref(false)
/** 递增以作废过期的搜索 / 加载更多响应 */
let searchGen = 0
/** 递增以重建单曲列表组件：切换平台 / 重新搜索时清空已勾选项 */
const songListKey = ref(0)
const quality = ref<DownloadQuality>('highest')
const withLyric = ref(true)
const lyricMode = ref<'external' | 'embedded'>('external')
const albumDownloadToFolder = ref(true)
const albumFolderTemplate = ref('{album}')
let albumFolderSaveTimer: ReturnType<typeof setTimeout> | null = null
const { play, stop, current } = usePlayer()
const toast = useToast()
const detailSheetOpen = ref(false)
const downloading = ref(false)
const previewingTrackId = ref<string | null>(null)
let previewAbort: AbortController | null = null

const previewBusy = computed(
  () => previewingTrackId.value !== null && selected.value?.id === previewingTrackId.value,
)

type AlbumBucket = { albumId: string; album: string; count: number; sample: SearchTrack }

/**
 * 「搜索结果被单一专辑占据」检测（Issue #40 续）。
 *
 * QQ 歌曲搜索索引只覆盖一张专辑的一部分（单 query 上限约 1000 条，且是散落各段），
 * 靠翻页枚举全集是死路。命中率够高时直接给出整专入口，一步跳到专辑分页（那里能拿全部集数）。
 */
const dominantAlbum = computed<AlbumBucket | null>(() => {
  if (searchType.value !== 'song' || items.value.length < SEARCH_PAGE_SIZE) return null
  const buckets = new Map<string, AlbumBucket>()
  for (const t of items.value) {
    if (!t.albumId) continue
    const key = `${t.platform}:${t.albumId}`
    const cur = buckets.get(key)
    if (cur) cur.count += 1
    else buckets.set(key, { albumId: t.albumId, album: t.album, count: 1, sample: t })
  }
  let best: AlbumBucket | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket
  }
  if (!best) return null
  return best.count / items.value.length >= 0.6 ? best : null
})
const enqueueResult = ref<EnqueueResultPayload | null>(null)
const showEnqueueResult = ref(false)
/** 本次入队来源：决定结果弹窗「重试失败」走哪条重试路径 */
const enqueueOrigin = ref<'album' | 'song'>('album')
/** 上一次单曲批量提交的曲目，用于按 results 下标重试失败项 */
const lastSongBatch = ref<SearchTrack[]>([])

/**
 * 疑似重复预检弹窗（①A）。用户取消时 resolve(null)，调用方需中止本次入队。
 */
const dupDialogOpen = ref(false)
const dupItems = ref<DuplicateReviewItem[]>([])
let dupResolver: ((decisions: Map<number, DuplicateDecision> | null) => void) | null = null
/** 搜索结果页「已在库」徽标（C3）：命中曲目的 dedupKey 集合 */
const libraryKeys = ref<Set<string>>(new Set())
/** 专辑详情页「已在库」徽标（曲目来源不同，需独立预检） */
const albumLibraryKeys = ref<Set<string>>(new Set())
let libraryKeysTimer: ReturnType<typeof setTimeout> | null = null

function onDupConfirm(decisions: Map<number, DuplicateDecision>) {
  dupDialogOpen.value = false
  dupResolver?.(decisions)
  dupResolver = null
}

function onDupCancel() {
  dupDialogOpen.value = false
  dupResolver?.(null)
  dupResolver = null
}

/** 「不再提醒」→ 写入 skip 策略（设置页可改回） */
async function onDupMute() {
  try {
    await $fetch('/api/settings', { method: 'PUT', body: { duplicatePolicy: 'skip' } })
    toast.info('已设为自动跳过重复项，可在设置中改回')
  } catch {
    /* 静默：不影响本次裁决 */
  }
}

/**
 * 入队前预检：无重复返回空 Map 直接入队；用户取消返回 `null` 中止。
 * 预检本身失败时不阻断下载（交回服务端按策略处理）。
 */
async function checkDuplicates(
  rows: Array<{ title: string; artist: string; album?: string | null }>,
): Promise<Map<number, DuplicateDecision> | null> {
  try {
    const res = await $fetch<{ duplicates: DuplicateReviewItem[] }>(
      '/api/downloads/duplicate-check',
      {
        method: 'POST',
        body: {
          items: rows.map((r) => ({
            title: r.title,
            artist: r.artist,
            album: r.album ?? null,
            quality: quality.value,
          })),
        },
      },
    )
    if (!res.duplicates.length) return new Map()
    dupItems.value = res.duplicates
    dupDialogOpen.value = true
    return await new Promise<Map<number, DuplicateDecision> | null>((resolve) => {
      dupResolver = resolve
    })
  } catch {
    return new Map()
  }
}

/** 记录本次提交每条的裁决，供逐条回填 */
function actionFor(decisions: Map<number, DuplicateDecision>, index: number) {
  return decisions.get(index)
}

/** 刷新「已在库」徽标（上限 200 条已加载项，避免请求体过大） */
async function refreshLibraryKeys() {
  const tracks = items.value.slice(0, 200)
  if (!tracks.length) {
    libraryKeys.value = new Set()
    return
  }
  try {
    const res = await $fetch<{ duplicates: Array<{ dedupKey: string }> }>(
      '/api/downloads/duplicate-check',
      {
        method: 'POST',
        body: {
          items: tracks.map((t) => ({ title: t.title, artist: t.artist, album: t.album })),
        },
      },
    )
    libraryKeys.value = new Set(res.duplicates.map((d) => d.dedupKey))
  } catch {
    /* 徽标属增强信息，失败静默 */
  }
}

watch(items, () => {
  if (libraryKeysTimer) clearTimeout(libraryKeysTimer)
  libraryKeysTimer = setTimeout(() => {
    libraryKeysTimer = null
    void refreshLibraryKeys()
  }, 300)
})

/** 专辑曲目「已在库」预检（与搜索结果各自成集，避免互相干扰） */
async function refreshAlbumLibraryKeys() {
  const tracks = (albumDetail.value?.tracks || []).slice(0, 200)
  if (!tracks.length) {
    albumLibraryKeys.value = new Set()
    return
  }
  try {
    const res = await $fetch<{ duplicates: Array<{ dedupKey: string }> }>(
      '/api/downloads/duplicate-check',
      {
        method: 'POST',
        body: { items: tracks.map((t) => ({ title: t.title, artist: t.artist, album: t.album })) },
      },
    )
    albumLibraryKeys.value = new Set(res.duplicates.map((d) => d.dedupKey))
  } catch {
    /* 徽标属增强信息，失败静默 */
  }
}

watch(albumDetail, () => {
  void refreshAlbumLibraryKeys()
})

onBeforeUnmount(() => {
  if (libraryKeysTimer) {
    clearTimeout(libraryKeysTimer)
    libraryKeysTimer = null
  }
  if (albumFolderSaveTimer) {
    clearTimeout(albumFolderSaveTimer)
    albumFolderSaveTimer = null
  }
  previewAbort?.abort()
})
const {
  showHomeBanner,
  refresh: refreshFnOsAuth,
  dismissBanner,
} = useFnOsDirAuth()
const route = useRoute()
const showFnOsAuthDialog = computed(() => showHomeBanner.value && route.path === '/')

const searchPlaceholder = computed(() =>
  searchType.value === 'album' ? '搜索专辑名 / 歌手' : '搜索歌曲 / 歌手',
)

const currentPlatformAlbumCapable = computed(() => {
  const p = platforms.value.find((x) => x.id === platform.value)
  return p?.albumCapable !== false
})

function ensureAlbumPlatform() {
  const cur = platforms.value.find((x) => x.id === platform.value)
  if (searchType.value === 'album' && cur && !cur.albumCapable) {
    const fallback = platforms.value.find((x) => x.albumCapable) || platforms.value[0]
    if (fallback) platform.value = fallback.id
  }
}

function selectTrack(t: SearchTrack) {
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
      albumDownloadToFolder?: boolean
      albumFolderTemplate?: string
    }>('/api/settings')
    withLyric.value = s.downloadLyric
    lyricMode.value = s.lyricMode || 'external'
    if (DOWNLOAD_QUALITY_OPTIONS.some((o) => o.id === s.defaultQuality)) {
      quality.value = s.defaultQuality as DownloadQuality
    }
    if (typeof s.albumDownloadToFolder === 'boolean') {
      albumDownloadToFolder.value = s.albumDownloadToFolder
    }
    if (typeof s.albumFolderTemplate === 'string' && s.albumFolderTemplate.trim()) {
      albumFolderTemplate.value = s.albumFolderTemplate
    }
  } catch {
    /* ignore */
  }
}

function persistAlbumFolderSettings() {
  if (albumFolderSaveTimer) clearTimeout(albumFolderSaveTimer)
  albumFolderSaveTimer = setTimeout(async () => {
    try {
      await $fetch('/api/settings', {
        method: 'PUT',
        body: {
          albumDownloadToFolder: albumDownloadToFolder.value,
          albumFolderTemplate: albumFolderTemplate.value.trim() || '{album}',
        },
      })
    } catch {
      /* ignore — 入队仍会带上当前值 */
    }
  }, 400)
}

function onAlbumDownloadToFolder(v: boolean) {
  albumDownloadToFolder.value = v
  persistAlbumFolderSettings()
}

function onAlbumFolderTemplate(v: string) {
  albumFolderTemplate.value = v
  persistAlbumFolderSettings()
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
  dismissBanner()
  void navigateTo('/settings?fnosAuth=1')
}

function isMobileViewport() {
  return import.meta.client && window.matchMedia('(max-width: 768px)').matches
}

function resetAlbumView() {
  view.value = 'results'
  albumDetail.value = null
  selectedAlbum.value = null
  albumGen++
  albumCursor.value = 0
  albumHasMore.value = false
  albumLoadingMore.value = false
  albumTotal.value = null
}

function resetSearchPaging() {
  currentPage.value = 1
  hasMore.value = false
  loadingMore.value = false
}

async function doSearch() {
  if (!keyword.value.trim()) return
  const gen = ++searchGen
  resetAlbumView()
  resetSearchPaging()
  songListKey.value++
  loadingText.value = '搜索中…'
  loading.value = true
  try {
    const res = await $fetch<{
      type: 'song' | 'album'
      items: SearchTrack[] | SearchAlbumItem[]
      platforms: PlatformTab[]
      sourceHint: string[]
      hasMore?: boolean
      filtered?: number
    }>('/api/search', {
      method: 'POST',
      body: {
        platform: platform.value,
        keyword: keyword.value,
        page: 1,
        type: searchType.value,
      },
    })
    if (gen !== searchGen) return
    if (res.platforms?.length) platforms.value = res.platforms
    ensureAlbumPlatform()
    const pageItems = res.items || []
    hasMore.value = res.hasMore ?? searchPageHasMore(pageItems.length)
    currentPage.value = 1
    if (searchType.value === 'album') {
      albumItems.value = pageItems as SearchAlbumItem[]
      items.value = []
      selected.value = null
      selectedAlbum.value = albumItems.value[0] || null
      if (!res.sourceHint?.length) {
        toast.warning('当前平台没有可用音源，下载前请先到「音源管理」导入')
      } else if (!albumItems.value.length) {
        toast.info('未找到相关专辑')
      }
    } else {
      items.value = pageItems as SearchTrack[]
      albumItems.value = []
      selectedAlbum.value = null
      selected.value = items.value[0] || null
      if (!res.sourceHint?.length) {
        toast.warning('当前平台没有可用音源，试听/下载前请先到「音源管理」导入')
      } else if (!items.value.length) {
        toast.info('未找到相关歌曲')
      }
    }
  } catch (e: unknown) {
    if (gen !== searchGen) return
    toast.error(apiErrorMessage(e, '搜索失败'))
    items.value = []
    albumItems.value = []
    selected.value = null
    selectedAlbum.value = null
    hasMore.value = false
  } finally {
    if (gen === searchGen) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  if (!keyword.value.trim()) return
  const gen = searchGen
  const nextPage = currentPage.value + 1
  loadingMore.value = true
  try {
    const res = await $fetch<{
      type: 'song' | 'album'
      items: SearchTrack[] | SearchAlbumItem[]
      hasMore?: boolean
      filtered?: number
    }>('/api/search', {
      method: 'POST',
      body: {
        platform: platform.value,
        keyword: keyword.value,
        page: nextPage,
        type: searchType.value,
      },
    })
    if (gen !== searchGen) return
    const pageItems = res.items || []
    if (searchType.value === 'album') {
      const existing = new Set(albumItems.value.map((a) => a.id))
      const unique = (pageItems as SearchAlbumItem[]).filter((a) => !existing.has(a.id))
      albumItems.value = albumItems.value.concat(unique)
    } else {
      const existing = new Set(items.value.map((t) => t.id))
      const unique = (pageItems as SearchTrack[]).filter((t) => !existing.has(t.id))
      items.value = items.value.concat(unique)
    }
    currentPage.value = nextPage
    // 空页 / 不满一页停止；不因「未撑满视口」自动连环请求
    hasMore.value = res.hasMore ?? searchPageHasMore(pageItems.length)
    // 上游把「相关推荐」凑满一页时会被服务端过滤；到末尾时提示一次，引导去专辑看全集
    if (res.hasMore === false && (res.filtered || 0) > 0) {
      toast.info(
        `已达上游可检索结果末尾，已过滤 ${res.filtered} 条不相关推荐；要看完整集数请切到「专辑」搜索`,
      )
    }
  } catch (e: unknown) {
    if (gen !== searchGen) return
    hasMore.value = false
    toast.error(apiErrorMessage(e, '加载更多失败'))
  } finally {
    if (gen === searchGen) loadingMore.value = false
  }
}

watch(platform, () => {
  if (keyword.value.trim()) void doSearch()
})

watch(searchType, () => {
  ensureAlbumPlatform()
  resetAlbumView()
  resetSearchPaging()
  items.value = []
  albumItems.value = []
  selected.value = null
  selectedAlbum.value = null
  if (keyword.value.trim()) void doSearch()
})

async function openAlbumDetail(album: SearchAlbumItem) {
  selectedAlbum.value = album
  if (
    albumDetail.value?.album.externalId === album.externalId &&
    albumDetail.value?.album.platform === album.platform
  ) {
    if (isMobileViewport()) view.value = 'albumDetail'
    return
  }
  const gen = ++albumGen
  loadingText.value = '加载专辑曲目…'
  loading.value = true
  albumLoadingMore.value = false
  try {
    const res = await $fetch<AlbumPageData>('/api/album/detail', {
      method: 'POST',
      body: {
        platform: album.platform,
        albumId: album.externalId,
        cursor: 0,
        albumTitle: album.title,
        albumArtist: album.artist,
        albumCover: album.cover,
      },
    })
    if (gen !== albumGen) return
    albumDetail.value = { album: res.album, tracks: res.tracks }
    albumCursor.value = res.nextCursor
    albumHasMore.value = res.hasMore
    albumTotal.value = res.total ?? null
    // H5：全屏详情；PC：留在分栏，右侧直接展示曲目
    view.value = isMobileViewport() ? 'albumDetail' : 'results'
    // 首屏之后**在后台把剩余集数补齐**：用户不该为了「知道专辑不完整」而去数条数
    if (res.hasMore) void startAlbumFill()
  } catch (e: unknown) {
    if (gen !== albumGen) return
    toast.error(apiErrorMessage(e, '加载专辑失败'))
    albumDetail.value = null
    albumCursor.value = 0
    albumHasMore.value = false
    albumTotal.value = null
  } finally {
    if (gen === albumGen) loading.value = false
  }
}

/**
 * 触底 / 手动「加载更多」：只追加一页，不重拉已加载部分。
 * `silent` 用于后台补齐剩余页 —— 失败不弹错，保留已加载内容即可。
 */
async function loadMoreAlbumTracks(silent = false) {
  const detail = albumDetail.value
  const album = selectedAlbum.value
  if (!detail || !album) return false
  if (albumLoadingMore.value || !albumHasMore.value) return false
  const gen = albumGen
  albumLoadingMore.value = true
  try {
    const res = await $fetch<AlbumPageData>('/api/album/detail', {
      method: 'POST',
      body: {
        platform: album.platform,
        albumId: album.externalId,
        cursor: albumCursor.value,
        albumTitle: album.title,
        albumArtist: album.artist,
        albumCover: album.cover,
      },
    })
    if (gen !== albumGen || !albumDetail.value) return false
    const seen = new Set(albumDetail.value.tracks.map((t) => `${t.platform}:${t.externalId}`))
    const fresh = res.tracks.filter((t) => !seen.has(`${t.platform}:${t.externalId}`))
    // 就地追加：保持 detail 引用不变，避免子组件 watch 重置用户已勾选状态
    albumDetail.value.tracks.push(...fresh)
    albumDetail.value.album = res.album
    albumCursor.value = res.nextCursor
    albumHasMore.value = res.hasMore
    if (res.total != null) albumTotal.value = res.total
    void refreshAlbumLibraryKeys()
    return fresh.length > 0
  } catch (e: unknown) {
    if (gen !== albumGen) return false
    albumHasMore.value = false
    if (!silent) toast.error(apiErrorMessage(e, '加载更多曲目失败'))
    return false
  } finally {
    if (gen === albumGen) albumLoadingMore.value = false
  }
}

/**
 * 后台补齐剩余集数（打开专辑后自动执行）。
 *
 * 动机：专辑只加载首页时，用户看到「已加载 500 / 500」很容易以为这就是全部，
 * 结果「全选 + 下载」只下到一部分。这里串行把剩余页拉完，让列表与计数都是真实全集。
 * 失败/切换专辑即停，已加载内容保留。
 */
let albumFillPromise: Promise<void> | null = null

async function fillAlbumRemaining() {
  const gen = albumGen
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // 连续无进展的次数上限：避免空页 / 全重复页把循环卡死
  let stalled = 0
  while (albumDetail.value && albumHasMore.value && gen === albumGen) {
    // 用户手动点了「加载更多」→ 等这一发完成，不要因此退出补齐
    if (albumLoadingMore.value) {
      await sleep(150)
      continue
    }
    const added = await loadMoreAlbumTracks(true)
    if (added) {
      stalled = 0
      continue
    }
    if (!albumHasMore.value || gen !== albumGen) return
    if (++stalled >= 3) return
    await sleep(200)
  }
}

function startAlbumFill(): Promise<void> {
  if (albumFillPromise) return albumFillPromise
  albumFillPromise = fillAlbumRemaining().finally(() => {
    albumFillPromise = null
  })
  return albumFillPromise
}

/** 批量动作前确保「已加载」= 「全部」；无更多页时立即返回 */
async function ensureAlbumFilled() {
  if (!albumHasMore.value) return
  await startAlbumFill()
}

async function openAlbumFromTrack(t: SearchTrack) {
  if (!t.albumId) {
    toast.info('该曲目未携带专辑 ID，无法跳转整专')
    return
  }
  const album: SearchAlbumItem = {
    id: `${t.platform}:${t.albumId}`,
    externalId: t.albumId,
    title: t.album || '专辑',
    artist: t.artist,
    cover: t.cover,
    platform: t.platform,
  }
  platform.value = t.platform
  if (searchType.value !== 'album') {
    // watch(searchType) 会清空状态；下一拍再开详情
    searchType.value = 'album'
    await nextTick()
  }
  await openAlbumDetail(album)
}

async function preview() {
  if (!selected.value) return
  if (previewAbort) {
    previewAbort.abort()
    previewAbort = null
  }
  stop()
  const abortController = new AbortController()
  previewAbort = abortController
  previewingTrackId.value = selected.value.id
  try {
    const res = await $fetch<{ url: string; quality: string }>('/api/preview', {
      method: 'POST',
      body: {
        platform: selected.value.platform,
        musicInfo: selected.value.musicInfo,
        quality: quality.value,
      },
      signal: abortController.signal,
    })
    if (abortController.signal.aborted || previewAbort !== abortController) return
    await play({
      title: selected.value.title,
      artist: selected.value.artist,
      url: res.url,
    })
  } catch (e: unknown) {
    if (abortController.signal.aborted || previewAbort !== abortController) return
    const err = e as { name?: string }
    if (err?.name === 'AbortError') return
    toast.error(apiErrorMessage(e, '试听失败'))
  } finally {
    if (previewAbort === abortController) {
      previewAbort = null
      previewingTrackId.value = null
    }
  }
}

watch(current, (track) => {
  if (track || !previewAbort) return
  previewAbort.abort()
  previewAbort = null
  previewingTrackId.value = null
})

async function download() {
  if (!selected.value || downloading.value) return
  const track = selected.value
  downloading.value = true
  try {
    // ①A：入队前预检，有疑似重复先弹窗裁决；用户取消则中止
    const decisions = await checkDuplicates([
      { title: track.title, artist: track.artist, album: track.album },
    ])
    if (decisions === null) return

    const outcome = await $fetch<{ kind: 'enqueued' | 'replaced' | 'skipped' }>(
      '/api/downloads',
      {
        method: 'POST',
        body: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          platform: track.platform,
          quality: quality.value,
          musicInfo: track.musicInfo,
          externalId: track.externalId,
          matchMethod: 'id',
          downloadLyric: withLyric.value,
          lyricMode: lyricMode.value,
          duplicateAction: actionFor(decisions, 0),
        },
      },
    )
    if (outcome.kind === 'skipped') toast.info('已在库中，已跳过')
    else if (outcome.kind === 'replaced') toast.success('已替换并重新入队')
    else toast.success('已加入下载队列')
    useDownloadBadge().notifyChanged()
    void refreshLibraryKeys()
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

async function enqueueAlbumTracks(indices: number[]) {
  if (!albumDetail.value || !indices.length || downloading.value) return
  const loaded = albumDetail.value.tracks.length
  // 「全选」等价于「整专」：统一走服务端流式，既不受已加载集数限制，也避免提交数千条的巨型请求体
  if (loaded > 0 && indices.length >= loaded) {
    await enqueueWholeAlbum()
    return
  }
  const tracks = indices
    .map((i) => albumDetail.value!.tracks[i])
    .filter(Boolean)
  if (!tracks.length) {
    toast.warning('没有可入队的曲目')
    return
  }
  downloading.value = true
  loadingText.value = '入队中…'
  loading.value = true
  try {
    const { album } = albumDetail.value
    // ①A：先预检，重复项交给聚合弹窗裁决
    const decisions = await checkDuplicates(
      tracks.map((t) => ({ title: t.title, artist: t.artist, album: t.album || album.title })),
    )
    if (decisions === null) return

    const res = await $fetch<EnqueueResultPayload>('/api/playlist/enqueue', {
      method: 'POST',
      body: {
        title: album.title,
        platform: album.platform,
        url: `album://${album.platform}/${album.externalId}`,
        tracks: tracks.map((t, i) => ({
          externalId: t.externalId,
          title: t.title,
          artist: t.artist,
          album: t.album || album.title,
          duration: t.duration,
          platform: t.platform,
          musicInfo: t.musicInfo,
          matchMethod: 'id',
          duplicateAction: actionFor(decisions, i),
        })),
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        quality: quality.value,
        albumDownloadToFolder: albumDownloadToFolder.value,
        albumFolderTemplate: albumFolderTemplate.value.trim() || '{album}',
        albumArtist: album.artist,
      },
    })
    enqueueResult.value = res
    enqueueOrigin.value = 'album'
    showEnqueueResult.value = true
    useDownloadBadge().notifyChanged()
    void refreshLibraryKeys()
    void refreshAlbumLibraryKeys()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    downloading.value = false
    loading.value = false
  }
}

/**
 * 整专下载（Issue #40）：不依赖已加载的曲目 —— 服务端按游标自己翻页拉全 + 入队，
 * 前端只消费 NDJSON 进度。2637 集的专辑也不会撑爆首屏或详情响应。
 */
async function enqueueWholeAlbum() {
  const detail = albumDetail.value
  const album = selectedAlbum.value
  if (!detail || !album || downloading.value) return
  downloading.value = true
  loading.value = true
  loadingText.value = '拉取专辑曲目…'
  try {
    const res = await fetchAlbumEnqueueAllNdjson(
      {
        platform: album.platform,
        albumId: album.externalId,
        albumTitle: album.title,
        albumArtist: album.artist,
        albumCover: album.cover,
        quality: quality.value,
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        albumDownloadToFolder: albumDownloadToFolder.value,
        albumFolderTemplate: albumFolderTemplate.value.trim() || '{album}',
      },
      {
        onStart: (total, stage) => {
          if (stage === 'matching') loadingText.value = `入队中…（共 ${total} 集）`
        },
        onFetchProgress: (e) => {
          loadingText.value = e.total
            ? `拉取专辑曲目 ${e.index}/${e.total}`
            : `拉取专辑曲目 ${e.index}`
        },
        onProgress: (e) => {
          loadingText.value = `入队中 ${e.index}/${e.total}`
        },
      },
    )
    enqueueResult.value = res
    enqueueOrigin.value = 'album'
    showEnqueueResult.value = true
    if (!albumTotal.value && res.total) albumTotal.value = res.total
    useDownloadBadge().notifyChanged()
    void refreshAlbumLibraryKeys()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '整专下载失败'))
  } finally {
    downloading.value = false
    loading.value = false
  }
}

/**
 * 单曲搜索结果批量入队：曲目自带 musicInfo，服务端直通匹配（不再逐首搜索）。
 * 不传 albumDownloadToFolder，因此不会按专辑建文件夹。
 */
async function enqueueSelectedSongs(tracks: SearchTrack[]) {
  if (!tracks.length || downloading.value) return
  downloading.value = true
  loadingText.value = '入队中…'
  loading.value = true
  try {
    // ①A：先预检，重复项交给聚合弹窗裁决
    const decisions = await checkDuplicates(
      tracks.map((t) => ({ title: t.title, artist: t.artist, album: t.album })),
    )
    if (decisions === null) return

    const res = await $fetch<EnqueueResultPayload>('/api/playlist/enqueue', {
      method: 'POST',
      body: {
        title: '批量下载',
        platform: platform.value,
        url: '',
        tracks: tracks.map((t, i) => ({
          externalId: t.externalId,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          platform: t.platform,
          musicInfo: t.musicInfo,
          matchMethod: 'id',
          duplicateAction: actionFor(decisions, i),
        })),
        downloadLyric: withLyric.value,
        lyricMode: lyricMode.value,
        quality: quality.value,
      },
    })
    lastSongBatch.value = tracks
    enqueueOrigin.value = 'song'
    enqueueResult.value = res
    showEnqueueResult.value = true
    useDownloadBadge().notifyChanged()
    void refreshLibraryKeys()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '入队失败'))
  } finally {
    downloading.value = false
    loading.value = false
  }
}

async function retryFailedEnqueue() {
  const results = enqueueResult.value?.results
  if (!results?.length) return

  if (enqueueOrigin.value === 'song') {
    // 服务端按提交顺序填充 results，故失败项下标即提交数组下标
    const failedIndices = results.map((r, i) => (r.ok ? -1 : i)).filter((i) => i >= 0)
    const tracks = failedIndices
      .map((i) => lastSongBatch.value[i])
      .filter((t): t is SearchTrack => Boolean(t))
    if (!tracks.length) {
      toast.info('没有可重试的失败项')
      return
    }
    showEnqueueResult.value = false
    await enqueueSelectedSongs(tracks)
    return
  }

  // 专辑：保持原有按曲名匹配的重试行为
  if (!albumDetail.value) return
  const failedTitles = new Set(
    results.filter((r) => !r.ok).map((r) => r.title),
  )
  const indices = albumDetail.value.tracks
    .map((t, i) => (failedTitles.has(t.title) ? i : -1))
    .filter((i) => i >= 0)
  if (!indices.length) {
    toast.info('没有可重试的失败项')
    return
  }
  showEnqueueResult.value = false
  await enqueueAlbumTracks(indices)
}
</script>

<template>
  <div class="page page-home">
    <PageLoading :show="loading" :text="loadingText" />
    <FnOsDirAuthDialog
      :open="showFnOsAuthDialog"
      @authorize="goFnOsAuthorize"
      @dismiss="dismissBanner()"
    />
    <EnqueueResultDialog
      v-model:open="showEnqueueResult"
      :result="enqueueResult"
      continue-label="继续搜索"
      @close="showEnqueueResult = false"
      @retry-failed="retryFailedEnqueue"
    />

    <DuplicateReviewDialog
      v-model:open="dupDialogOpen"
      :items="dupItems"
      @confirm="onDupConfirm"
      @cancel="onDupCancel"
      @mute="onDupMute"
    />

    <div class="search-bar">
      <input
        v-model="keyword"
        class="input"
        :placeholder="searchPlaceholder"
        @keyup.enter="doSearch"
      />
      <button class="btn" type="button" :disabled="loading" @click="doSearch">
        {{ loading ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <div class="type-tabs">
      <button
        type="button"
        class="type-tab"
        :class="{ active: searchType === 'song' }"
        @click="searchType = 'song'"
      >
        单曲
      </button>
      <button
        type="button"
        class="type-tab"
        :class="{ active: searchType === 'album' }"
        @click="searchType = 'album'"
      >
        专辑
      </button>
    </div>

    <div class="tabs">
      <button
        v-for="p in platforms"
        :key="p.id"
        type="button"
        class="tab"
        :class="{ active: platform === p.id, disabled: searchType === 'album' && !p.albumCapable }"
        :disabled="searchType === 'album' && !p.albumCapable"
        @click="platform = p.id"
      >
        {{ p.label }}
        <span class="muted">({{ p.sourceCount }})</span>
      </button>
    </div>

    <p v-if="searchType === 'album' && !currentPlatformAlbumCapable" class="muted tip">
      当前平台暂不支持专辑搜索，已自动切换可用平台
    </p>

    <!-- H5：全屏专辑详情 -->
    <div v-if="view === 'albumDetail' && albumDetail" class="card album-detail-wrap">
      <AlbumDetailPanel
        :detail="albumDetail"
        :loading="downloading"
        :quality="quality"
        :with-lyric="withLyric"
        :lyric-mode="lyricMode"
        :album-download-to-folder="albumDownloadToFolder"
        :album-folder-template="albumFolderTemplate"
        :show-back="true"
        :library-keys="albumLibraryKeys"
        :has-more="albumHasMore"
        :loading-more="albumLoadingMore"
        :total-count="albumTotal"
        @back="resetAlbumView"
        @enqueue="enqueueAlbumTracks"
        @enqueue-all="enqueueWholeAlbum"
        @load-more="loadMoreAlbumTracks"
        @update:quality="quality = $event"
        @update:with-lyric="withLyric = $event"
        @update:lyric-mode="lyricMode = $event"
        @update:album-download-to-folder="onAlbumDownloadToFolder"
        @update:album-folder-template="onAlbumFolderTemplate"
      />
    </div>

    <!-- 单曲 / 专辑搜索结果（PC 专辑：左侧列表 + 右侧直接曲目） -->
    <div v-else class="split">
      <div class="card list">
        <template v-if="searchType === 'song'">
          <div v-if="dominantAlbum" class="album-hint">
            <div class="album-hint-text">
              <strong>{{ dominantAlbum.album || '同一专辑' }}</strong>
              <span class="muted">
                当前 {{ items.length }} 条结果中有 {{ dominantAlbum.count }} 条来自这张专辑；上游搜索最多只覆盖约
                1000 条，全部集数请直接打开专辑。
              </span>
            </div>
            <button class="btn btn-ghost" type="button" @click="openAlbumFromTrack(dominantAlbum.sample)">
              打开专辑
            </button>
          </div>
          <SongResultList
            :key="`song-${platform}-${songListKey}`"
            :items="items"
            :selected-id="selected?.id"
            :has-more="hasMore"
            :loading-more="loadingMore || loading"
            :enqueueing="downloading"
            :library-keys="libraryKeys"
            @select="selectTrack"
            @enqueue="enqueueSelectedSongs"
            @load-more="loadMore"
          />
        </template>
        <template v-else>
          <AlbumResultList
            :key="`album-${platform}`"
            :items="albumItems"
            :selected-id="selectedAlbum?.id"
            :has-more="hasMore"
            :loading-more="loadingMore || loading"
            @select="openAlbumDetail"
            @load-more="loadMore"
          />
        </template>
      </div>

      <div class="card detail desktop-only" :class="{ 'detail-album': searchType === 'album' && albumDetail }">
        <template v-if="searchType === 'song' && selected">
          <CoverImage :src="selected.cover" class="detail-cover" :alt="selected.title" :lazy="false" />
          <h2>{{ selected.title }}</h2>
          <p class="muted">{{ selected.artist }}</p>
          <p class="muted">专辑：{{ selected.album || '—' }}</p>
          <p class="muted">平台：{{ selected.platform }} · ID：{{ selected.externalId }}</p>
          <button
            v-if="selected.albumId"
            class="btn btn-ghost album-link"
            type="button"
            @click="openAlbumFromTrack(selected)"
          >
            查看专辑
          </button>

          <label class="field">
            <span>音质</span>
            <select v-model="quality" class="select">
              <option v-for="opt in DOWNLOAD_QUALITY_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
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
            <button class="btn btn-ghost" type="button" :disabled="previewBusy" @click="preview">
              {{ previewBusy ? '取链中…' : '试听' }}
            </button>
            <button class="btn" type="button" @click="download">下载</button>
          </div>
        </template>
        <template v-else-if="searchType === 'album' && albumDetail">
          <AlbumDetailPanel
            :detail="albumDetail"
            :loading="downloading"
            :quality="quality"
            :with-lyric="withLyric"
            :lyric-mode="lyricMode"
            :album-download-to-folder="albumDownloadToFolder"
            :album-folder-template="albumFolderTemplate"
            :show-back="false"
            :library-keys="albumLibraryKeys"
            :has-more="albumHasMore"
            :loading-more="albumLoadingMore"
            :total-count="albumTotal"
            @enqueue="enqueueAlbumTracks"
            @enqueue-all="enqueueWholeAlbum"
            @load-more="loadMoreAlbumTracks"
            @update:quality="quality = $event"
            @update:with-lyric="withLyric = $event"
            @update:lyric-mode="lyricMode = $event"
            @update:album-download-to-folder="onAlbumDownloadToFolder"
            @update:album-folder-template="onAlbumFolderTemplate"
          />
        </template>
        <p v-else class="muted">
          {{ searchType === 'album' ? '选择左侧专辑查看曲目' : '选择左侧歌曲查看详情' }}
        </p>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="detailSheetOpen && selected && searchType === 'song'"
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
            <button
              v-if="selected.albumId"
              class="btn btn-ghost album-link"
              type="button"
              @click="openAlbumFromTrack(selected); closeDetailSheet()"
            >
              查看专辑
            </button>

            <label class="field">
              <span>音质</span>
              <select v-model="quality" class="select">
                <option v-for="opt in DOWNLOAD_QUALITY_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
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
              <button class="btn btn-ghost" type="button" :disabled="previewBusy" @click="preview">
                {{ previewBusy ? '取链中…' : '试听' }}
              </button>
              <button class="btn" type="button" :disabled="downloading" @click="download">
                {{ downloading ? '入队中…' : '下载' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

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
  margin-bottom: 8px;
  flex-shrink: 0;
}
.search-bar .input {
  flex: 1;
}
.search-bar .btn {
  min-width: 100px;
}
.type-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.type-tab {
  border: 1px solid var(--border);
  background: transparent;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
}
.type-tab.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
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
.tab.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.split {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.album-detail-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  -webkit-overflow-scrolling: touch;
}
.detail.detail-album {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.detail.detail-album :deep(.album-detail) {
  height: 100%;
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
  .album-detail-wrap {
    /* H5 全屏详情：允许整体滚动，曲目区至少 400px */
    overflow: auto;
  }
  .actions {
    flex-direction: column;
  }
  .actions .btn {
    width: 100%;
  }
}

@media (max-width: 860px) and (min-width: 769px) {
  .split {
    grid-template-columns: 1fr;
  }
}

.list {
  padding: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  -webkit-overflow-scrolling: touch;
}
.album-hint {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in oklab, var(--accent) 8%, var(--surface));
}
.album-hint-text {
  display: grid;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
}
.album-hint-text strong {
  font-size: 13px;
  word-break: break-word;
}
.album-hint .btn {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 8px;
}
.detail-cover {
  width: 100%;
  height: 180px;
  margin-bottom: 8px;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--accent-soft);
}
.detail {
  min-height: 0;
  overflow: auto;
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
.album-link {
  margin-bottom: 8px;
  width: 100%;
}
.tip {
  font-size: 13px;
  margin: 0 0 8px;
  flex-shrink: 0;
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
</style>
