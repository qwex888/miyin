<script setup lang="ts">
import type { SwitchSourceOption } from '~/composables/useSwitchSourcePreference'

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
  batch_id?: string | null
}

const route = useRoute()
const batchFilter = computed(() => {
  const v = route.query.batchId
  return typeof v === 'string' && v.trim() ? v.trim() : ''
})

const tab = ref<'running' | 'completed' | 'failed'>('running')
const items = ref<Task[]>([])
const selected = ref<Set<string>>(new Set())
const selectAllState = ref(false) // 是否勾选了当前 Tab 下的所有任务（跨页/全量）
const loading = ref(false)
const loadingText = ref('加载中…')
const pageLoading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const currentPage = ref(1)
const PAGE_SIZE = 50
const toast = useToast()
const deleteDialogOpen = ref(false)
const deleteDialogTitle = ref('确认删除')
const deleteDialogDesc = ref('')
let deletePending: null | { mode: 'one'; task: Task } | { mode: 'batch' } = null

const { notifyChanged, onSnapshot, onTask, startWatching } = useDownloadEvents()
let offSnapshot: (() => void) | null = null
let offTask: (() => void) | null = null
let latestSseSnapshot: Task[] = []
type SourceRowLite = {
  id: string
  name: string
  enabled: number
  status: string
  platforms: string
}

const switchDialogOpen = ref(false)
const switchDialogTitle = ref('选择音源')
const switchDialogDesc = ref('选择后将使用该音源重新下载，并记住为默认选项。')
const switchOptions = ref<SwitchSourceOption[]>([])
const sourceNameById = ref<Record<string, string>>({})
let switchPending: null | { mode: 'one'; task: Task } | { mode: 'batch'; tasks: Task[] } = null

const qualityDialogOpen = ref(false)
const qualityDialogTitle = ref('更换音质')
const qualityDialogDesc = ref('仅对本任务生效，不会改全局默认音质，也不会影响其他下载任务。')
const qualityCurrent = ref<string | null>(null)
let qualityPending: null | { mode: 'one'; task: Task } | { mode: 'batch'; tasks: Task[] } = null

const {
  rememberSwitchSource,
  resolveSourceIdForPlatform,
} = useSwitchSourcePreference()

function parsePlatforms(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function loadSourceNames() {
  try {
    const res = await $fetch<{ items: SourceRowLite[] }>('/api/sources')
    const map: Record<string, string> = {}
    for (const s of res.items || []) map[s.id] = s.name
    sourceNameById.value = map
  } catch {
    /* ignore */
  }
}

function toSwitchOptions(rows: SourceRowLite[], platforms: string[]): SwitchSourceOption[] {
  const want = new Set(platforms)
  return rows
    .filter((r) => r.enabled === 1 && r.status === 'ok')
    .map((r) => ({
      id: r.id,
      name: r.name,
      platforms: parsePlatforms(r.platforms),
    }))
    .filter((o) => o.platforms.some((p) => want.has(p)))
}

function optionsForPlatform(
  rows: SourceRowLite[],
  platform: string,
): SwitchSourceOption[] {
  return toSwitchOptions(rows, [platform]).filter((o) => o.platforms.includes(platform))
}

async function loadOkSources(): Promise<SourceRowLite[]> {
  const res = await $fetch<{ items: SourceRowLite[] }>('/api/sources')
  return res.items || []
}

async function openSwitchForTask(t: Task) {
  try {
    const rows = await loadOkSources()
    const opts = optionsForPlatform(rows, t.platform)
    if (!opts.length) {
      toast.warning(`没有可用音源（平台 ${t.platform}）`)
      return
    }
    switchPending = { mode: 'one', task: t }
    switchOptions.value = opts
    switchDialogTitle.value = '选择音源'
    switchDialogDesc.value = `为「${t.title}」选择音源后重新下载，并记住为默认选项。`
    switchDialogOpen.value = true
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载音源失败'))
  }
}

async function openSwitchForBatch() {
  if (!selectedCount.value) return
  const tasks = selectAllState.value
    ? items.value
    : items.value.filter((t) => selected.value.has(t.id))
  if (!tasks.length && !selectAllState.value) return
  try {
    const rows = await loadOkSources()
    // 全选时展示全部可用音源；否则按当前选中任务的平台过滤
    const platforms = selectAllState.value
      ? [...new Set(rows.flatMap((r) => parsePlatforms(r.platforms)))]
      : [...new Set(tasks.map((t) => t.platform))]
    const opts = selectAllState.value
      ? rows
          .filter((r) => r.enabled === 1 && r.status === 'ok')
          .map((r) => ({
            id: r.id,
            name: r.name,
            platforms: parsePlatforms(r.platforms),
          }))
      : toSwitchOptions(rows, platforms)
    if (!opts.length) {
      toast.warning('选中任务没有可用音源')
      return
    }
    switchPending = { mode: 'batch', tasks }
    switchOptions.value = opts
    switchDialogTitle.value = '批量换源'
    switchDialogDesc.value = selectAllState.value
      ? `为当前失败 Tab 下全部 ${selectedCount.value} 个任务选择音源后重新下载。不支持该源的平台任务将失败并保留在失败列表。`
      : platforms.length > 1
        ? `已选 ${tasks.length} 个任务（含 ${platforms.length} 个平台）。优先使用所选音源；不支持的平台将使用该平台已记住的音源。`
        : `为选中的 ${tasks.length} 个任务选择音源后重新下载，并记住为默认选项。`
    switchDialogOpen.value = true
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载音源失败'))
  }
}

async function onSwitchConfirm(payload: { sourceId: string; source: SwitchSourceOption }) {
  const pending = switchPending
  if (!pending) {
    switchDialogOpen.value = false
    return
  }
  rememberSwitchSource(payload.source)
  loadingText.value = '换源重试中…'
  loading.value = true
  try {
    if (pending.mode === 'one') {
      const res = await $fetch<{ sourceName: string }>(
        `/api/downloads/${pending.task.id}/switch-source`,
        { method: 'POST', body: { sourceId: payload.sourceId } },
      )
      toast.success(`已切换至音源「${res.sourceName}」并重试`)
    } else if (selectAllState.value) {
      const res = await $fetch<{ items: Array<{ sourceName?: string; error?: string }> }>(
        '/api/downloads/batch-switch-source',
        {
          method: 'POST',
          body: { allWithTab: 'failed', sourceId: payload.sourceId },
        },
      )
      const ok = res.items.filter((i) => !i.error).length
      const fail = res.items.length - ok
      clearSelection()
      const text = `换源重试：成功 ${ok}` + (fail ? `，失败 ${fail}` : '')
      if (fail) toast.warning(text)
      else toast.success(text)
    } else {
      const rows = await loadOkSources()
      const sourceById: Record<string, string> = {}
      for (const t of pending.tasks) {
        const platformOpts = optionsForPlatform(rows, t.platform)
        const sid = resolveSourceIdForPlatform(t.platform, platformOpts, payload.source)
        if (sid) sourceById[t.id] = sid
      }
      const res = await $fetch<{ items: Array<{ sourceName?: string; error?: string }> }>(
        '/api/downloads/batch-switch-source',
        { method: 'POST', body: { ids: pending.tasks.map((t) => t.id), sourceById } },
      )
      const ok = res.items.filter((i) => !i.error).length
      const fail = res.items.length - ok
      clearSelection()
      const text = `换源重试：成功 ${ok}` + (fail ? `，失败 ${fail}` : '')
      if (fail) toast.warning(text)
      else toast.success(text)
    }
    switchDialogOpen.value = false
    switchPending = null
    await loadTabItems({ silent: true, reset: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '换源失败'))
  } finally {
    loading.value = false
  }
}

function onSwitchCancel() {
  switchPending = null
}

const statusMap = {
  running: ['queued', 'running'],
  completed: ['completed'],
  failed: ['failed', 'cancelled'],
}

type ServerStats = {
  total: number
  completed: number
  failed: number
  running: number
  queued: number
  cancelled: number
}
const serverStats = ref<ServerStats | null>(null)

const tabCounts = computed(() => {
  if (serverStats.value) {
    return {
      running: serverStats.value.running + serverStats.value.queued,
      completed: serverStats.value.completed,
      failed: serverStats.value.failed + serverStats.value.cancelled,
    }
  }
  return { running: 0, completed: 0, failed: 0 }
})

const currentTabTotal = computed(() => {
  return tabCounts.value[tab.value] || 0
})

const selectedCount = computed(() => {
  if (selectAllState.value) return currentTabTotal.value
  return selected.value.size
})

function clearBatchFilter() {
  void navigateTo({ path: '/queue', query: {} })
}

function formatSize(n: number | null | undefined) {
  if (n == null || n <= 0) return ''
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function platformText(platform: string) {
  return `平台：${platformLabel(platform)}`
}

function sourceText(t: Task) {
  if (!t.source_id) return ''
  const name = sourceNameById.value[t.source_id]
  return name ? `音源：${name}` : `音源：${t.source_id.slice(0, 8)}`
}

function qualityText(quality: string | null | undefined) {
  if (!quality) return ''
  return `音质：${qualityLabel(quality)}`
}

/** attempts=失败次数；≥1 时语义化为「已重试下载 N 次」 */
function attemptsText(attempts: number | null | undefined) {
  const n = Number(attempts || 0)
  if (n <= 0) return ''
  return `已重试下载 ${n} 次`
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

function sortRunningItems(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    const rank = (t: Task) => (t.status === 'running' ? 0 : t.status === 'queued' ? 1 : 2)
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return (b.progress || 0) - (a.progress || 0)
    return 0
  })
}

function downloadListParams(page: number) {
  const params: Record<string, string | number> = {
    tab: tab.value,
    page,
    pageSize: PAGE_SIZE,
  }
  if (batchFilter.value) params.batch_id = batchFilter.value
  return params
}

async function fetchStats() {
  try {
    const params = batchFilter.value ? { batch_id: batchFilter.value } : undefined
    const res = await $fetch<ServerStats>('/api/downloads/stats', { params })
    if (res) serverStats.value = res
  } catch {
    /* ignore */
  }
}

/** 进度 SSE 很密，统计只在可能影响 Tab 计数时刷新，并防抖合并 */
let statsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFetchStats(immediate = false) {
  if (immediate) {
    if (statsTimer) {
      clearTimeout(statsTimer)
      statsTimer = null
    }
    void fetchStats()
    return
  }
  if (statsTimer) return
  statsTimer = setTimeout(() => {
    statsTimer = null
    void fetchStats()
  }, 800)
}

async function loadTabItems(opts?: { silent?: boolean; reset?: boolean }) {
  if (opts?.reset) {
    currentPage.value = 1
    selected.value = new Set()
    selectAllState.value = false
  }
  if (!opts?.silent && opts?.reset) {
    pageLoading.value = true
    loadingText.value = '加载队列中…'
  }
  try {
    const [res] = await Promise.all([
      $fetch<{ items: Task[]; total?: number; totalPages?: number }>('/api/downloads', {
        params: downloadListParams(currentPage.value),
      }),
      fetchStats(),
    ])
    const newItems = res.items || []
    if (currentPage.value === 1) {
      items.value = tab.value === 'running' ? sortRunningItems(newItems) : newItems
    } else {
      const existingIds = new Set(items.value.map((t) => t.id))
      const uniqueNew = newItems.filter((t) => !existingIds.has(t.id))
      items.value = items.value.concat(uniqueNew)
    }
    hasMore.value = (res.totalPages ? currentPage.value < res.totalPages : newItems.length >= PAGE_SIZE)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载队列失败'))
  } finally {
    if (!opts?.silent && opts?.reset) pageLoading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const nextPage = currentPage.value + 1
    const res = await $fetch<{ items: Task[]; total?: number; totalPages?: number }>('/api/downloads', {
      params: downloadListParams(nextPage),
    })
    const newItems = res.items || []
    const existingIds = new Set(items.value.map((t) => t.id))
    const uniqueNew = newItems.filter((t) => !existingIds.has(t.id))
    items.value = items.value.concat(uniqueNew)
    if (selectAllState.value) {
      for (const t of uniqueNew) selected.value.add(t.id)
    }
    currentPage.value = nextPage
    hasMore.value = (res.totalPages ? nextPage < res.totalPages : newItems.length >= PAGE_SIZE)
  } catch {
    /* ignore */
  } finally {
    loadingMore.value = false
  }
}

function upsert(task: Task) {
  const isDeleted = (task as { status?: string }).status === 'deleted'
  const prev = items.value.find((t) => t.id === task.id)
  // 仅状态变化会影响 Tab 角标计数；纯进度更新不要打 /stats
  const statusChanged = isDeleted || !prev || prev.status !== task.status
  if (statusChanged) scheduleFetchStats()

  const allowed = statusMap[tab.value]
  const belongsToBatch = !batchFilter.value || task.batch_id === batchFilter.value
  const belongsToTab = !isDeleted && belongsToBatch && allowed.includes(task.status)

  const idx = items.value.findIndex((t) => t.id === task.id)
  if (isDeleted) {
    if (idx >= 0) items.value.splice(idx, 1)
    selected.value.delete(task.id)
    selected.value = new Set(selected.value)
    return
  }

  if (belongsToTab) {
    if (idx >= 0) {
      items.value[idx] = task
    } else if (tab.value === 'running') {
      items.value.push(task)
    }
    if (tab.value === 'running') {
      items.value = sortRunningItems(items.value)
    }
  } else {
    // 状态变迁（例如 running -> completed），从当前 tab 列表中移除
    if (idx >= 0) {
      items.value.splice(idx, 1)
      selected.value.delete(task.id)
      selected.value = new Set(selected.value)
    }
  }
}

function bindDownloadEvents() {
  offSnapshot?.()
  offTask?.()
  offSnapshot = onSnapshot((list) => {
    latestSseSnapshot = list as Task[]
    // 连接首帧 / 轮询快照：合并刷新，避免与 loadTabItems 叠打
    scheduleFetchStats()
  })
  offTask = onTask((task) => {
    upsert(task as Task)
  })
}

function toggleOne(id: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) {
    next.add(id)
    if (items.value.length > 0 && next.size === currentTabTotal.value) {
      selectAllState.value = true
    }
  } else {
    next.delete(id)
    selectAllState.value = false
  }
  selected.value = next
}

function toggleSelectAll() {
  if (selectAllState.value || (items.value.length > 0 && selected.value.size === items.value.length)) {
    clearSelection()
  } else {
    selectAllState.value = true
    selected.value = new Set(items.value.map((t) => t.id))
  }
}
function clearSelection() {
  selectAllState.value = false
  selected.value = new Set()
}

async function cancel(t: Task) {
  if (!confirm(`确认取消任务「${t.title}」？未完成文件将被删除；若已完成也会删除本地文件。`)) return
  try {
    await $fetch(`/api/downloads/${t.id}`, { method: 'DELETE' })
    await loadTabItems({ silent: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '取消失败'))
  }
}

async function retry(t: Task) {
  try {
    await $fetch(`/api/downloads/${t.id}/retry`, { method: 'POST', body: { resetAttempts: true } })
    await loadTabItems({ silent: true })
    notifyChanged()
    toast.success('已重新入队')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '重试失败'))
  }
}

async function switchSource(t: Task) {
  await openSwitchForTask(t)
}

function openQualityForTask(t: Task) {
  qualityPending = { mode: 'one', task: t }
  qualityCurrent.value = t.quality
  qualityDialogTitle.value = '更换音质'
  qualityDialogDesc.value = `为「${t.title}」选择音质后重新下载。仅本任务生效，不记忆默认选项。`
  qualityDialogOpen.value = true
}

function openQualityForBatch() {
  if (!selectedCount.value) return
  const tasks = selectAllState.value
    ? items.value
    : items.value.filter((t) => selected.value.has(t.id))
  if (!tasks.length && !selectAllState.value) return
  qualityPending = { mode: 'batch', tasks }
  qualityCurrent.value = tasks[0]?.quality ?? null
  qualityDialogTitle.value = '批量换音质'
  qualityDialogDesc.value = selectAllState.value
    ? `为当前失败 Tab 下全部 ${selectedCount.value} 个任务选择音质后重新下载。仅影响选中范围，不改全局默认。`
    : `为选中的 ${tasks.length} 个任务选择音质后重新下载。仅影响选中任务，不改全局默认。`
  qualityDialogOpen.value = true
}

async function onQualityConfirm(payload: { quality: string }) {
  const pending = qualityPending
  if (!pending) {
    qualityDialogOpen.value = false
    return
  }
  loadingText.value = '换音质重试中…'
  loading.value = true
  try {
    if (pending.mode === 'one') {
      const res = await $fetch<{ quality: string }>(`/api/downloads/${pending.task.id}/switch-quality`, {
        method: 'POST',
        body: { quality: payload.quality },
      })
      toast.success(`已切换至音质「${qualityLabel(res.quality)}」并重试`)
    } else {
      const res = await $fetch<{ quality: string; items: Array<{ error?: string }> }>(
        '/api/downloads/batch-switch-quality',
        {
          method: 'POST',
          body: {
            ids: selectAllState.value ? undefined : pending.tasks.map((t) => t.id),
            allWithTab: selectAllState.value ? 'failed' : undefined,
            quality: payload.quality,
          },
        },
      )
      const ok = res.items.filter((i) => !i.error).length
      const fail = res.items.length - ok
      clearSelection()
      const text = `换音质「${qualityLabel(res.quality)}」：成功 ${ok}` + (fail ? `，失败 ${fail}` : '')
      if (fail) toast.warning(text)
      else toast.success(text)
    }
    qualityDialogOpen.value = false
    qualityPending = null
    await loadTabItems({ silent: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '换音质失败'))
  } finally {
    loading.value = false
  }
}

function onQualityCancel() {
  qualityPending = null
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
  deleteDialogDesc.value = selectAllState.value
    ? `确定删除当前分类下全部 ${selectedCount.value} 条${label}任务吗？默认仅删除队列记录，可勾选同时删除本地文件。`
    : `确定删除选中的 ${selectedCount.value} 条${label}任务吗？默认仅删除队列记录，可勾选同时删除本地文件。`
  deleteDialogOpen.value = true
}

async function onDeleteConfirm(payload: { deleteLocalFiles: boolean }) {
  const pending = deletePending
  if (!pending) {
    deleteDialogOpen.value = false
    return
  }
  loadingText.value = '删除中…'
  loading.value = true
  try {
    if (pending.mode === 'one') {
      const t = pending.task
      await $fetch(`/api/downloads/${t.id}/purge`, {
        method: 'POST',
        body: { deleteLocalFiles: payload.deleteLocalFiles },
      })
      selected.value.delete(t.id)
      selected.value = new Set(selected.value)
      toast.success(payload.deleteLocalFiles ? '已删除任务与本地文件' : '已删除任务记录')
    } else {
      const res = await $fetch<{ deleted: number }>('/api/downloads/batch-delete', {
        method: 'POST',
        body: {
          ids: selectAllState.value ? undefined : [...selected.value],
          allWithTab: selectAllState.value ? (tab.value as 'completed' | 'failed') : undefined,
          deleteLocalFiles: payload.deleteLocalFiles,
        },
      })
      clearSelection()
      toast.success(
        `已删除 ${res.deleted} 条` + (payload.deleteLocalFiles ? '（含本地文件）' : ''),
      )
    }
    deleteDialogOpen.value = false
    deletePending = null
    await loadTabItems({ silent: true, reset: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '删除失败'))
  } finally {
    loading.value = false
  }
}

function onDeleteCancel() {
  deletePending = null
}

async function batchCancel() {
  if (!selectedCount.value) return
  const n = selectedCount.value
  const msg = selectAllState.value
    ? `确认取消所有进行中的 ${n} 个下载任务？将删除未完成（及竞态已完成）的本地文件。`
    : `确认取消选中的 ${n} 个下载任务？将删除未完成（及竞态已完成）的本地文件。`
  if (!confirm(msg)) return
  loading.value = true
  loadingText.value = '批量取消中…'
  try {
    await $fetch('/api/downloads/batch-cancel', {
      method: 'POST',
      body: {
        ids: selectAllState.value ? undefined : [...selected.value],
        allWithTab: selectAllState.value ? 'running' : undefined,
      },
    })
    clearSelection()
    toast.success(`已批量取消 ${n} 个任务`)
    await loadTabItems({ silent: true, reset: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '批量取消失败'))
  } finally {
    loading.value = false
  }
}

async function batchRetry() {
  if (!selectedCount.value) return
  const n = selectedCount.value
  const msg = selectAllState.value
    ? `确认重试当前所有 ${n} 个失败任务？`
    : `确认重试选中的 ${n} 个失败任务？`
  if (!confirm(msg)) return
  loading.value = true
  loadingText.value = '批量重试中…'
  try {
    await $fetch('/api/downloads/batch-retry', {
      method: 'POST',
      body: {
        ids: selectAllState.value ? undefined : [...selected.value],
        allWithTab: selectAllState.value ? 'failed' : undefined,
        resetAttempts: true,
      },
    })
    clearSelection()
    toast.success(`已批量重试 ${n} 个任务`)
    await loadTabItems({ silent: true, reset: true })
    notifyChanged()
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '批量重试失败'))
  } finally {
    loading.value = false
  }
}

async function batchSwitchSource() {
  await openSwitchForBatch()
}

watch(tab, () => {
  void loadTabItems({ reset: true })
})
watch(batchFilter, () => {
  selected.value = new Set()
  selectAllState.value = false
  void loadTabItems({ reset: true })
})
const showPageLoading = computed(() => pageLoading.value || loading.value)

onMounted(() => {
  // 仅订阅；建连由顶栏 startWatching 负责（若尚未启动则补一次）
  startWatching()
  bindDownloadEvents()
  void loadSourceNames()
  void loadTabItems({ reset: true })
})
onBeforeUnmount(() => {
  offSnapshot?.()
  offTask?.()
  offSnapshot = null
  offTask = null
  if (statsTimer) {
    clearTimeout(statsTimer)
    statsTimer = null
  }
})
onActivated(() => {
  bindDownloadEvents()
  void loadTabItems({ reset: true, silent: true })
})

useRegisterPageRefresh(async () => {
  await loadSourceNames()
  await loadTabItems({ reset: true })
})
</script>

<template>
  <div class="page page-queue">
    <PageLoading :show="showPageLoading" :text="loadingText" />
    <div class="tabs">
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'running' }"
        @click="tab = 'running'"
      >
        进行中
        <span class="tab-count">
          ({{ tabCounts.running }})
          <!-- <small v-if="serverStats && serverStats.running > 0" class="tab-sub-count">
            [{{ serverStats.running }}下载/{{ serverStats.queued }}排队]
          </small> -->
        </span>
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'completed' }"
        @click="tab = 'completed'"
      >
        已完成
        <span class="tab-count">({{ tabCounts.completed }})</span>
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'failed' }" @click="tab = 'failed'">
        失败
        <span class="tab-count">({{ tabCounts.failed }})</span>
      </button>
    </div>

    <p v-if="batchFilter" class="batch-filter-bar">
      当前仅显示本批入队任务
      <button class="link-btn" type="button" @click="clearBatchFilter">显示全部</button>
    </p>

    <div class="toolbar">
      <label class="check">
        <input
          type="checkbox"
          :checked="selectAllState || (items.length > 0 && selected.size === currentTabTotal)"
          :disabled="!items.length"
          @change="toggleSelectAll"
        />
        <span>全选{{ currentTabTotal > 0 ? ` (${currentTabTotal})` : '' }}</span>
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
          <div class="toolbar-actions">
            <button class="btn btn-sm" type="button" :disabled="loading" @click="batchRetry">
              批量重试（{{ selectedCount }}）
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="loading"
              @click="openQualityForBatch"
            >
              批量换音质（{{ selectedCount }}）
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="loading"
              @click="batchSwitchSource"
            >
              批量换源（{{ selectedCount }}）
            </button>
            <button class="btn btn-danger btn-sm" type="button" :disabled="loading" @click="batchDelete">
              批量删除（{{ selectedCount }}）
            </button>
          </div>
        </template>
      </template>
    </div>

    <div class="list-pane">
      <VirtualList
        v-if="items.length"
        :key="tab"
        :items="items"
        :estimate-size="120"
        :dynamic="true"
        :has-more="hasMore"
        :loading="loadingMore"
        fill
        @load-more="loadMore"
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
                <span>{{ platformText(t.platform) }}</span>
                <span v-if="sourceText(t)">{{ sourceText(t) }}</span>
                <span v-if="t.quality">{{ qualityText(t.quality) }}</span>
                <span v-if="t.file_size">{{ formatSize(t.file_size) }}</span>
                <span v-if="attemptsText(t.attempts)">{{ attemptsText(t.attempts) }}</span>
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
                @click="openQualityForTask(t)"
              >
                换音质
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
    </div>

    <DeleteConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDesc"
      :loading="loading"
      confirm-label="删除"
      @confirm="onDeleteConfirm"
      @cancel="onDeleteCancel"
    />
    <SwitchSourceDialog
      v-model:open="switchDialogOpen"
      :title="switchDialogTitle"
      :description="switchDialogDesc"
      :options="switchOptions"
      :loading="loading"
      @confirm="onSwitchConfirm"
      @cancel="onSwitchCancel"
    />
    <SwitchQualityDialog
      v-model:open="qualityDialogOpen"
      :title="qualityDialogTitle"
      :description="qualityDialogDesc"
      :current-quality="qualityCurrent"
      :loading="loading"
      @confirm="onQualityConfirm"
      @cancel="onQualityCancel"
    />
  </div>
</template>

<style scoped>
/* 填满主内容区；列表内部滚动，避免整页出现滚动条 */
.page-queue {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding-top: 16px;
  padding-bottom: 16px;
  box-sizing: border-box;
}
.batch-filter-bar {
  margin: 0 0 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--muted);
  background: var(--accent-soft);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
  text-decoration: underline;
}
.tabs {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  padding: 8px 2px 10px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  font-size: 14px;
  line-height: 1.3;
}
.tab-count {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
.tab-sub-count {
  font-size: 11px;
  color: var(--accent);
  margin-left: 2px;
  font-weight: 500;
}
.tab.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.tab.active .tab-count {
  font-weight: 600;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}
.list-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  align-items: start;
  margin: 0 0 8px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-sizing: border-box;
  height: auto;
  overflow: visible;
}
.task-check {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 2px;
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
  line-height: 1.45;
  overflow: visible;
  text-overflow: unset;
  white-space: normal;
  word-break: break-all;
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
  margin: 0;
}
.tip {
  color: var(--accent);
  margin: 0 0 8px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .page-queue {
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .tabs {
    gap: 0;
    overflow: hidden;
    width: 100%;
    flex-wrap: nowrap;
  }
  .tab {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 10px 2px;
    text-align: center;
    font-size: 13px;
  }
  .toolbar {
    gap: 8px;
  }
  .toolbar-actions {
    width: 100%;
  }
  .toolbar .btn,
  .toolbar-actions .btn {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }
  .task {
    grid-template-columns: 28px minmax(0, 1fr);
    padding: 12px;
  }
  .task-ops {
    grid-column: 2;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .task-ops .btn {
    min-height: 36px;
  }
  .progress {
    max-width: none;
  }
}

@media (max-width: 560px) {
  .task {
    grid-template-columns: 28px minmax(0, 1fr);
  }
  .task-ops {
    grid-column: 2;
  }
  .progress {
    max-width: none;
  }
}
</style>
