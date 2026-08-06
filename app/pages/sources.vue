<script setup lang="ts">
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
const showAdd = ref(false)
const importText = ref('')
const addName = ref('')
const addUrl = ref('')
const loading = ref(false)
const msg = ref('')
const selected = ref<Set<string>>(new Set())

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

async function load() {
  const res = await $fetch<{ items: Source[] }>('/api/sources')
  items.value = res.items
  // 清理已不存在的选中项
  const ids = new Set(res.items.map((s) => s.id))
  selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
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

async function doImport() {
  loading.value = true
  msg.value = ''
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
    msg.value =
      `导入完成：成功 ${ok}/${res.total}` +
      (skipped ? `，跳过 ${skipped}` : '') +
      (renamed ? `，改名 ${renamed}` : '')
    showImport.value = false
    importText.value = ''
    await load()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '导入失败'
  } finally {
    loading.value = false
  }
}

async function doAdd() {
  const name = addName.value.trim()
  const url = addUrl.value.trim()
  if (!name || !url) {
    msg.value = '请填写名称和 URL'
    return
  }
  loading.value = true
  msg.value = ''
  try {
    const row = await $fetch<Source>('/api/sources', {
      method: 'POST',
      body: { name, url },
    })
    showAdd.value = false
    addName.value = ''
    addUrl.value = ''
    msg.value =
      row.status === 'ok'
        ? `已添加音源「${row.name}」`
        : `已添加「${row.name}」，但检测失败：${row.last_error || row.status}`
    await load()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '新增失败'
  } finally {
    loading.value = false
  }
}

async function checkAll() {
  loading.value = true
  try {
    await $fetch('/api/sources/check', { method: 'POST', body: {} })
    await load()
    msg.value = '检测完成'
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '检测失败'
  } finally {
    loading.value = false
  }
}

async function cleanup() {
  if (!confirm('确认清理所有失效音源？此操作不可撤销。')) return
  await $fetch('/api/sources/cleanup', { method: 'POST', body: { dryRun: false } })
  await load()
  msg.value = '已清理失效音源'
}

async function toggle(s: Source) {
  await $fetch(`/api/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } })
  await load()
}

async function remove(s: Source) {
  if (!confirm(`确认删除音源「${s.name}」？此操作不可撤销。`)) return
  await $fetch(`/api/sources/${s.id}`, { method: 'DELETE' })
  selected.value.delete(s.id)
  selected.value = new Set(selected.value)
  await load()
}

async function batchDelete() {
  if (!selectedCount.value) return
  if (!confirm(`确认删除选中的 ${selectedCount.value} 个音源？此操作不可撤销。`)) return
  loading.value = true
  try {
    const res = await $fetch<{ deleted: number }>('/api/sources/batch-delete', {
      method: 'POST',
      body: { ids: [...selected.value] },
    })
    selected.value = new Set()
    await load()
    msg.value = `已删除 ${res.deleted} 个音源`
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '批量删除失败'
  } finally {
    loading.value = false
  }
}

function platforms(s: Source) {
  try {
    return (JSON.parse(s.platforms) as string[]).join(', ') || '—'
  } catch {
    return '—'
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title">
        <h2>音源管理</h2>
        <div class="actions">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="checkAll">检测全部</button>
          <button class="btn btn-ghost" type="button" @click="cleanup">清理失效</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn" type="button" @click="showAdd = true">单个新增</button>
        <button class="btn btn-ghost" type="button" @click="showImport = true">批量导入</button>
        
        <button
          v-if="selectedCount > 0"
          class="btn btn-danger"
          type="button"
          :disabled="loading"
          @click="batchDelete"
        >
          删除选中（{{ selectedCount }}）
        </button>
      </div>
    </div>
    <p v-if="msg" class="tip">{{ msg }}</p>

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
              <div class="muted url">{{ s.url }}</div>
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
            <td class="muted">{{ s.last_checked_at || '—' }}</td>
            <td class="ops">
              <button class="btn btn-ghost" type="button" @click="toggle(s)">
                {{ s.enabled ? '停用' : '启用' }}
              </button>
              <button class="btn btn-ghost" type="button" @click="remove(s)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!items.length" class="muted empty">暂无音源，点击「单个新增」或「批量导入」</p>
    </div>

    <div v-if="showAdd" class="drawer-backdrop" @click.self="showAdd = false">
      <div class="drawer">
        <h3>单个新增</h3>
        <p class="muted">填写音源名称与脚本 URL。名称或 URL 已存在时会提示错误。</p>
        <label class="field">
          <span>名称</span>
          <input v-model="addName" class="input" placeholder="例如：惠布克" @keyup.enter="doAdd" />
        </label>
        <label class="field">
          <span>脚本 URL</span>
          <input
            v-model="addUrl"
            class="input"
            placeholder="https://…/latest.js"
            @keyup.enter="doAdd"
          />
        </label>
        <div class="actions" style="margin-top: 12px">
          <button
            class="btn"
            type="button"
            :disabled="loading || !addName.trim() || !addUrl.trim()"
            @click="doAdd"
          >
            {{ loading ? '提交中…' : '添加' }}
          </button>
          <button class="btn btn-ghost" type="button" @click="showAdd = false">取消</button>
        </div>
      </div>
    </div>

    <div v-if="showImport" class="drawer-backdrop" @click.self="showImport = false">
      <div class="drawer">
        <h3>批量导入</h3>
        <p class="muted">
          支持「名称+URL」同行或换行；名称可带「：」「【】」等符号（会自动清洗）。相同 URL
          会跳过；同名不同 URL 会改成「名称 (2)」。
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
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.url {
  font-size: 12px;
  word-break: break-all;
}
.ops {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tip {
  color: var(--accent);
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
.field {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}
.field span {
  font-size: 13px;
  color: var(--muted);
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
  .ops {
    width: 100%;
  }
  .ops .btn {
    flex: 1;
    min-height: 40px;
  }
  .table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .toolbar .title .actions {
    width: 65%;
  }
}
</style>
