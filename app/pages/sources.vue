<script setup lang="ts">
import type { ImportConflict } from '~/components/ImportConflictDialog.vue'

type Source = {
  id: string
  name: string
  url: string
  enabled: number
  status: string
  platforms: string
  last_checked_at: string | null
  last_error: string | null
}

const items = ref<Source[]>([])
const showImport = ref(false)
const showForm = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editing = ref<Source | null>(null)
const importText = ref('')
const loading = ref(false)
const loadingText = ref('加载中…')
const pageLoading = ref(true)
const selected = ref<Set<string>>(new Set())
const moreOpen = ref(false)
const rowOpsId = ref<string | null>(null)
const toast = useToast()

const showConflict = ref(false)
const conflictLoading = ref(false)
const conflictPreview = ref<{
  conflictCount: number
  newCount: number
  conflicts: ImportConflict[]
} | null>(null)
const pendingBundleFile = ref<File | null>(null)
const bundleInput = ref<HTMLInputElement | null>(null)

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)
const showPageLoading = computed(() => pageLoading.value || loading.value)

async function load(opts?: { silent?: boolean }) {
  if (!opts?.silent) {
    pageLoading.value = true
    loadingText.value = '加载音源中…'
  }
  try {
    const res = await $fetch<{ items: Source[] }>('/api/sources')
    items.value = res.items
    const ids = new Set(res.items.map((s) => s.id))
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载音源失败'))
  } finally {
    if (!opts?.silent) pageLoading.value = false
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
  selected.value = new Set(items.value.map((s) => s.id))
}

function openCreate() {
  formMode.value = 'create'
  editing.value = null
  showForm.value = true
  moreOpen.value = false
}

function openEdit(s: Source) {
  formMode.value = 'edit'
  editing.value = s
  showForm.value = true
}

async function doImport() {
  loadingText.value = '导入中…'
  loading.value = true
  try {
    const res = await $fetch<{
      total: number
      imported?: number
      skipped?: number
      renamed?: number
      results: any[]
    }>('/api/sources/import', {
      method: 'POST',
      body: { text: importText.value },
    })
    const ok = res.imported ?? res.results.filter((r) => r.ok).length
    const skipped = res.skipped ?? 0
    const renamed = res.renamed ?? 0
    const text =
      `导入完成：成功 ${ok}/${res.total}` +
      (skipped ? `，跳过 ${skipped}` : '') +
      (renamed ? `，改名 ${renamed}` : '')
    if (ok > 0) toast.success(text)
    else toast.warning(text)
    showImport.value = false
    importText.value = ''
    await load({ silent: true })
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '导入失败'))
  } finally {
    loading.value = false
  }
}

async function checkAll() {
  moreOpen.value = false
  loadingText.value = '检测中…'
  loading.value = true
  try {
    const res = await $fetch<{ items: Array<{ id: string; status: string; error?: string }> }>(
      '/api/sources/check',
      { method: 'POST', body: {} },
    )
    await load({ silent: true })
    const summary = summarizeSourceCheck(res.items || [])
    if (summary.level === 'success') toast.success(summary.message)
    else if (summary.level === 'warning') toast.warning(summary.message)
    else toast.error(summary.message)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '检测失败'))
  } finally {
    loading.value = false
  }
}

async function cleanup() {
  moreOpen.value = false
  if (!confirm('确认清理所有失效音源？此操作不可撤销。')) return
  loadingText.value = '清理中…'
  loading.value = true
  try {
    await $fetch('/api/sources/cleanup', { method: 'POST', body: { dryRun: false } })
    await load({ silent: true })
    toast.success('已清理失效音源')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '清理失败'))
  } finally {
    loading.value = false
  }
}

async function toggle(s: Source) {
  try {
    await $fetch(`/api/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } })
    await load({ silent: true })
    toast.success(s.enabled ? `已禁用「${s.name}」` : `已启用「${s.name}」`)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '更新失败'))
  }
}

async function remove(s: Source) {
  if (!confirm(`确认删除音源「${s.name}」？此操作不可撤销。`)) return
  try {
    await $fetch(`/api/sources/${s.id}`, { method: 'DELETE' })
    selected.value.delete(s.id)
    selected.value = new Set(selected.value)
    await load({ silent: true })
    toast.success(`已删除「${s.name}」`)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '删除失败'))
  }
}

async function batchDelete() {
  if (!selectedCount.value) return
  if (!confirm(`确认删除选中的 ${selectedCount.value} 个音源？此操作不可撤销。`)) return
  loadingText.value = '删除中…'
  loading.value = true
  try {
    const res = await $fetch<{ deleted: number }>('/api/sources/batch-delete', {
      method: 'POST',
      body: { ids: [...selected.value] },
    })
    selected.value = new Set()
    await load({ silent: true })
    toast.success(`已删除 ${res.deleted} 个音源`)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '批量删除失败'))
  } finally {
    loading.value = false
  }
}

async function exportBundle() {
  moreOpen.value = false
  loadingText.value = '导出中…'
  loading.value = true
  try {
    const ids = selectedCount.value > 0 ? [...selected.value] : undefined
    const qs = ids?.length ? `?ids=${ids.map(encodeURIComponent).join(',')}` : ''
    const blob = await $fetch<Blob>(`/api/sources/export${qs}`, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    a.href = url
    a.download = `miyin-sources-${stamp}.zip`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(ids?.length ? `已导出选中的 ${ids.length} 个音源` : '已导出完整包')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '导出失败'))
  } finally {
    loading.value = false
  }
}

function pickBundle() {
  moreOpen.value = false
  bundleInput.value?.click()
}

async function onBundleSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  pendingBundleFile.value = file
  loadingText.value = '解析完整包…'
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    fd.append('dryRun', 'true')
    const preview = await $fetch<{
      conflictCount: number
      newCount: number
      conflicts: ImportConflict[]
      total: number
    }>('/api/sources/import-bundle', { method: 'POST', body: fd })

    if (preview.conflictCount > 0) {
      conflictPreview.value = {
        conflictCount: preview.conflictCount,
        newCount: preview.newCount,
        conflicts: preview.conflicts || [],
      }
      showConflict.value = true
      return
    }

    await applyBundle('skip')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '导入完整包失败'))
    pendingBundleFile.value = null
  } finally {
    loading.value = false
  }
}

async function applyBundle(onConflict: 'overwrite' | 'skip') {
  const file = pendingBundleFile.value
  if (!file) return
  conflictLoading.value = true
  loadingText.value = '导入完整包…'
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    fd.append('onConflict', onConflict)
    const res = await $fetch<{
      imported: number
      overwritten: number
      skipped: number
      failed: number
      total: number
    }>('/api/sources/import-bundle', { method: 'POST', body: fd })
    showConflict.value = false
    pendingBundleFile.value = null
    conflictPreview.value = null
    const text =
      `导入完成：新增 ${res.imported}` +
      (res.overwritten ? `，覆盖 ${res.overwritten}` : '') +
      (res.skipped ? `，跳过 ${res.skipped}` : '') +
      (res.failed ? `，失败 ${res.failed}` : '')
    if (res.imported + res.overwritten > 0) toast.success(text)
    else toast.warning(text)
    await load({ silent: true })
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '导入完整包失败'))
  } finally {
    conflictLoading.value = false
    loading.value = false
  }
}

function onConflictCancel() {
  pendingBundleFile.value = null
  conflictPreview.value = null
}

function platforms(s: Source) {
  try {
    return (JSON.parse(s.platforms) as string[]).join(', ') || '—'
  } catch {
    return '—'
  }
}

function formatDate(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleString()
}

function displayUrl(s: Source) {
  if (!s.url || s.url.startsWith('local://')) return '本地脚本'
  return s.url
}

function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t?.closest?.('.more-wrap')) {
    moreOpen.value = false
    rowOpsId.value = null
  }
}

onMounted(load)
onMounted(() => window.addEventListener('click', onDocClick))
onBeforeUnmount(() => window.removeEventListener('click', onDocClick))

useRegisterPageRefresh(async () => {
  await load()
})

function toggleRowOps(id: string) {
  moreOpen.value = false
  rowOpsId.value = rowOpsId.value === id ? null : id
}

function runRowOp(s: Source, action: 'toggle' | 'edit' | 'remove') {
  rowOpsId.value = null
  if (action === 'toggle') void toggle(s)
  else if (action === 'edit') openEdit(s)
  else void remove(s)
}
</script>

<template>
  <div class="page">
    <PageLoading :show="showPageLoading" :text="loadingText" />
    <div class="toolbar">
      <div class="title">
        <h2>音源管理</h2>
      </div>
      <div class="actions">
        <button class="btn" type="button" @click="openCreate">单个新增</button>
        <button
          v-if="selectedCount > 0"
          class="btn btn-danger"
          type="button"
          :disabled="loading"
          @click="batchDelete"
        >
          删除选中（{{ selectedCount }}）
        </button>
        <div class="more-wrap">
          <button
            class="btn btn-ghost"
            type="button"
            :aria-expanded="moreOpen"
            @click.stop="rowOpsId = null; moreOpen = !moreOpen"
          >
            更多
          </button>
          <div v-if="moreOpen" class="more-panel" role="menu" @click.stop>
            <button type="button" role="menuitem" @click="showImport = true; moreOpen = false">
              批量导入（文本）
            </button>
            <button type="button" role="menuitem" @click="pickBundle">导入完整包</button>
            <button type="button" role="menuitem" :disabled="loading" @click="exportBundle">
              导出完整包{{ selectedCount ? `（选中 ${selectedCount}）` : '' }}
            </button>
            <hr />
            <button type="button" role="menuitem" :disabled="loading" @click="checkAll">
              检测全部
            </button>
            <button type="button" role="menuitem" @click="cleanup">清理失效</button>
          </div>
        </div>
      </div>
    </div>

    <input
      ref="bundleInput"
      type="file"
      accept=".zip,application/zip"
      hidden
      @change="onBundleSelected"
    />

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th class="check-col">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" />
            </th>
            <th>名称 / URL</th>
            <th>状态</th>
            <th>平台</th>
            <th>最近检测</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in items" :key="s.id">
            <td class="check-col">
              <input
                type="checkbox"
                :checked="selected.has(s.id)"
                @change="toggleOne(s.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td>
              <strong>{{ s.name }}</strong>
              <div class="muted url">{{ displayUrl(s) }}</div>
              <div v-if="s.last_error" class="err">{{ s.last_error }}</div>
            </td>
            <td>
              <span
                class="badge"
                :class="{
                  'badge-dead': s.status === 'dead',
                  'badge-unknown': s.status === 'unknown',
                }"
              >
                {{ s.enabled ? s.status : '已停用' }}
              </span>
            </td>
            <td>{{ platforms(s) }}</td>
            <td class="muted">{{ formatDate(s.last_checked_at) }}</td>
            <td class="ops">
              <div class="ops-desktop">
                <button class="btn btn-ghost" type="button" @click="toggle(s)">
                  {{ s.enabled ? '停用' : '启用' }}
                </button>
                <button class="btn btn-ghost" type="button" @click="openEdit(s)">编辑</button>
                <button class="btn btn-ghost" type="button" @click="remove(s)">删除</button>
              </div>
              <div class="ops-mobile more-wrap">
                <button
                  class="btn btn-ghost ops-more-btn"
                  type="button"
                  :aria-expanded="rowOpsId === s.id"
                  aria-label="行操作"
                  @click.stop="toggleRowOps(s.id)"
                >
                  ···
                </button>
                <div v-if="rowOpsId === s.id" class="more-panel" role="menu" @click.stop>
                  <button type="button" role="menuitem" @click="runRowOp(s, 'toggle')">
                    {{ s.enabled ? '停用' : '启用' }}
                  </button>
                  <button type="button" role="menuitem" @click="runRowOp(s, 'edit')">编辑</button>
                  <button type="button" role="menuitem" @click="runRowOp(s, 'remove')">删除</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!items.length" class="muted empty">暂无音源，点击「单个新增」或「更多 → 导入」</p>
    </div>

    <SourceFormDialog
      v-model:open="showForm"
      :mode="formMode"
      :source="editing"
      @saved="load({ silent: true })"
    />

    <ImportConflictDialog
      v-model:open="showConflict"
      :conflict-count="conflictPreview?.conflictCount || 0"
      :new-count="conflictPreview?.newCount || 0"
      :conflicts="conflictPreview?.conflicts || []"
      :loading="conflictLoading"
      @resolve="applyBundle"
      @cancel="onConflictCancel"
    />

    <div v-if="showImport" class="drawer-backdrop" @click.self="showImport = false">
      <div class="drawer">
        <h3>批量导入（文本）</h3>
        <p class="muted">
          支持「名称+URL」同行或换行；名称可带「：」「【】」等符号（会自动清洗）。相同 URL
          会跳过；同名不同 URL 会改成「名称 (2)」。本地备份请用「导入完整包」。
        </p>
        <textarea v-model="importText" class="textarea" placeholder="粘贴音源文本…" />
        <div class="actions" style="margin-top: 12px">
          <button class="btn" type="button" :disabled="loading || !importText.trim()" @click="doImport">
            导入
          </button>
          <button class="btn btn-ghost" type="button" @click="showImport = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.toolbar h2 {
  margin: 0;
}
.toolbar .title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.more-wrap {
  position: relative;
}
.more-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 200px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--border);
  /* --card 是 HSL 分量，不能直接当颜色；用实色 surface */
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.more-panel button {
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
}
.more-panel button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.more-panel button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.more-panel hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 4px 0;
}
.url {
  width: 80px;
  max-width: 80px;
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-all;
}
.ops {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  position: relative;
}
.ops-desktop {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ops-mobile {
  display: none;
}
.ops-more-btn {
  min-width: 40px;
  letter-spacing: 1px;
  font-weight: 700;
}
.err {
  color: var(--danger);
  font-size: 12px;
}
.empty {
  text-align: center;
  padding: 24px;
}
.check-col {
  width: 36px;
  text-align: center;
  vertical-align: middle;
}

@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .actions {
    width: 100%;
  }
  .actions .btn {
    flex: 1;
    min-width: 0;
  }
  .more-wrap {
    flex: 1;
  }
  .more-wrap > .btn {
    width: 100%;
  }
  .ops {
    width: auto;
    justify-content: flex-end;
  }
  .ops-desktop {
    display: none;
  }
  .ops-mobile {
    display: block;
  }
  .ops-mobile > .btn {
    width: auto;
    min-width: 40px;
  }
  .ops-mobile .more-panel {
    min-width: 140px;
  }
  .table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
</style>
