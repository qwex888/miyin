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
const importText = ref('')
const loading = ref(false)
const msg = ref('')

async function load() {
  const res = await $fetch<{ items: Source[] }>('/api/sources')
  items.value = res.items
}

async function doImport() {
  loading.value = true
  msg.value = ''
  try {
    const res = await $fetch<{ total: number; results: any[] }>('/api/sources/import', {
      method: 'POST',
      body: { text: importText.value },
    })
    const ok = res.results.filter((r) => r.ok).length
    msg.value = `导入完成：成功 ${ok}/${res.total}`
    showImport.value = false
    importText.value = ''
    await load()
  } catch (e: any) {
    msg.value = e?.data?.statusMessage || e?.message || '导入失败'
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
  if (!confirm('确认清理所有失效音源？')) return
  await $fetch('/api/sources/cleanup', { method: 'POST', body: { dryRun: false } })
  await load()
  msg.value = '已清理失效音源'
}

async function toggle(s: Source) {
  await $fetch(`/api/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } })
  await load()
}

async function remove(s: Source) {
  if (!confirm(`删除音源「${s.name}」？`)) return
  await $fetch(`/api/sources/${s.id}`, { method: 'DELETE' })
  await load()
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
      <h2>音源管理</h2>
      <div class="actions">
        <button class="btn" type="button" @click="showImport = true">批量导入</button>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="checkAll">检测全部</button>
        <button class="btn btn-ghost" type="button" @click="cleanup">清理失效</button>
      </div>
    </div>
    <p v-if="msg" class="tip">{{ msg }}</p>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>名称 / URL</th>
            <th>状态</th>
            <th>平台</th>
            <th>最近检测</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in items" :key="s.id">
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
      <p v-if="!items.length" class="muted empty">暂无音源，点击「批量导入」粘贴音源.txt</p>
    </div>

    <div v-if="showImport" class="drawer-backdrop" @click.self="showImport = false">
      <div class="drawer">
        <h3>批量导入</h3>
        <p class="muted">支持多行 URL，或粘贴「名称 + URL」格式的音源.txt</p>
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
</style>
