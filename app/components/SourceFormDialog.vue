<script setup lang="ts">
type Source = {
  id: string
  name: string
  url: string
  enabled: number
  status: string
  last_error: string | null
}

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  mode: 'create' | 'edit'
  source?: Source | null
}>()

const emit = defineEmits<{
  saved: []
}>()

const toast = useToast()
const loading = ref(false)
const name = ref('')
const sourceTab = ref<'url' | 'upload' | 'script'>('url')
const url = ref('')
const scriptText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const dirInput = ref<HTMLInputElement | null>(null)
const pendingFiles = ref<File[]>([])
const dragOver = ref(false)
const originalScript = ref('')

watch(
  () => open.value,
  async (v) => {
    if (!v) return
    loading.value = false
    pendingFiles.value = []
    dragOver.value = false
    if (props.mode === 'edit' && props.source) {
      name.value = props.source.name
      url.value = props.source.url?.startsWith('local://') ? '' : props.source.url || ''
      sourceTab.value = 'script'
      scriptText.value = ''
      originalScript.value = ''
      try {
        loading.value = true
        const res = await $fetch<{ script: string }>(`/api/sources/${props.source.id}/script`)
        scriptText.value = res.script
        originalScript.value = res.script
      } catch (e: unknown) {
        toast.error(apiErrorMessage(e, '加载脚本失败'))
      } finally {
        loading.value = false
      }
    } else {
      name.value = ''
      url.value = ''
      scriptText.value = ''
      originalScript.value = ''
      sourceTab.value = 'url'
    }
  },
)

function onCancel() {
  if (loading.value) return
  open.value = false
}

function pickFiles() {
  fileInput.value?.click()
}

function pickDir() {
  dirInput.value?.click()
}

function collectJsFiles(list: FileList | File[] | null): File[] {
  if (!list) return []
  return [...list].filter((f) => /\.js$/i.test(f.name))
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  pendingFiles.value = collectJsFiles(input.files)
  if (pendingFiles.value.length === 1 && !name.value.trim()) {
    name.value = pendingFiles.value[0]!.name.replace(/\.js$/i, '')
  }
  if (pendingFiles.value.length === 1) {
    pendingFiles.value[0]!.text().then((t) => {
      scriptText.value = t
    })
  }
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const files = collectJsFiles(e.dataTransfer?.files || null)
  if (!files.length) {
    toast.warning('请拖入 .js 音源文件')
    return
  }
  sourceTab.value = 'upload'
  pendingFiles.value = files
  if (files.length === 1 && !name.value.trim()) {
    name.value = files[0]!.name.replace(/\.js$/i, '')
  }
  if (files.length === 1) {
    files[0]!.text().then((t) => {
      scriptText.value = t
    })
  }
}

async function fetchUrlToScript() {
  const u = url.value.trim()
  if (!u) {
    toast.warning('请填写脚本 URL')
    return
  }
  if (!/^https?:\/\//i.test(u)) {
    toast.warning('URL 需以 http(s):// 开头')
    return
  }
  loading.value = true
  try {
    // 借用新建接口拉脚本：先不落库，用浏览器 fetch 同源代理不存在——改走临时：create 时服务端拉
    // 编辑/新建统一：前端直接请求远程可能 CORS，所以仅切换到提示「保存时由服务端拉取」
    // 若已有 script 且来自 URL 刷新：用 refresh API（仅编辑）
    if (props.mode === 'edit' && props.source && props.source.url === u) {
      if (
        scriptText.value &&
        scriptText.value !== originalScript.value &&
        !confirm('从 URL 重新拉取将覆盖当前已修改的脚本（含 Key），是否继续？')
      ) {
        return
      }
      const row = await $fetch<Source>(`/api/sources/${props.source.id}/script`, {
        method: 'PUT',
        body: { refreshFromUrl: true },
      })
      const res = await $fetch<{ script: string }>(`/api/sources/${props.source.id}/script`)
      scriptText.value = res.script
      originalScript.value = res.script
      sourceTab.value = 'script'
      toast.success(row.status === 'ok' ? '已从 URL 更新脚本' : `已更新，检测：${row.last_error || row.status}`)
      emit('saved')
    } else if (props.mode === 'create') {
      toast.info('填写名称后点保存，将由服务端拉取该 URL')
      sourceTab.value = 'url'
    } else {
      toast.warning('编辑模式下更换 URL 请先保存名称后使用「从 URL 刷新」（需 URL 与记录一致）。可改为上传或粘贴脚本。')
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '拉取失败'))
  } finally {
    loading.value = false
  }
}

async function doSave() {
  const n = name.value.trim()
  if (!n) {
    toast.warning('请填写名称')
    return
  }

  loading.value = true
  try {
    if (props.mode === 'edit' && props.source) {
      if (sourceTab.value === 'url' && url.value.trim() && url.value.trim() === props.source.url) {
        await fetchUrlToScript()
        return
      }
      if (!scriptText.value.trim() || scriptText.value.trim().length < 20) {
        toast.warning('脚本内容过短，请切换到「脚本」编辑或上传文件')
        return
      }
      const row = await $fetch<Source>(`/api/sources/${props.source.id}/script`, {
        method: 'PUT',
        body: { script: scriptText.value, name: n },
      })
      open.value = false
      if (row.status === 'ok') toast.success(`已保存「${row.name}」`)
      else toast.warning(`已保存「${row.name}」，检测：${row.last_error || row.status}`)
      emit('saved')
      return
    }

    // create
    if (sourceTab.value === 'upload' && pendingFiles.value.length > 1) {
      const fd = new FormData()
      for (const f of pendingFiles.value) fd.append('files', f, f.name)
      const res = await $fetch<{ imported: number; total: number; renamed?: number }>('/api/sources/upload', {
        method: 'POST',
        body: fd,
      })
      open.value = false
      toast.success(
        `上传完成：成功 ${res.imported}/${res.total}` + (res.renamed ? `，改名 ${res.renamed}` : ''),
      )
      emit('saved')
      return
    }

    if (sourceTab.value === 'upload' && pendingFiles.value.length === 1) {
      const text = scriptText.value || (await pendingFiles.value[0]!.text())
      const row = await $fetch<Source>('/api/sources/upload', {
        method: 'POST',
        body: { name: n, script: text },
      })
      open.value = false
      if (row.status === 'ok') toast.success(`已添加「${row.name}」`)
      else toast.warning(`已添加「${row.name}」，检测：${row.last_error || row.status}`)
      emit('saved')
      return
    }

    if (sourceTab.value === 'script') {
      if (!scriptText.value.trim() || scriptText.value.trim().length < 20) {
        toast.warning('脚本内容过短')
        return
      }
      const row = await $fetch<Source>('/api/sources/upload', {
        method: 'POST',
        body: { name: n, script: scriptText.value, url: url.value.trim() || undefined },
      })
      open.value = false
      if (row.status === 'ok') toast.success(`已添加「${row.name}」`)
      else toast.warning(`已添加「${row.name}」，检测：${row.last_error || row.status}`)
      emit('saved')
      return
    }

    // url create
    const u = url.value.trim()
    if (!u) {
      toast.warning('请填写脚本 URL，或改用上传/脚本')
      return
    }
    const row = await $fetch<Source>('/api/sources', {
      method: 'POST',
      body: { name: n, url: u },
    })
    open.value = false
    if (row.status === 'ok') toast.success(`已添加音源「${row.name}」`)
    else toast.warning(`已添加「${row.name}」，但检测失败：${row.last_error || row.status}`)
    emit('saved')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '保存失败'))
  } finally {
    loading.value = false
  }
}

async function doCheck() {
  if (props.mode !== 'edit' || !props.source) {
    toast.info('请先保存音源后再检测')
    return
  }
  loading.value = true
  try {
    if (scriptText.value && scriptText.value !== originalScript.value) {
      await $fetch(`/api/sources/${props.source.id}/script`, {
        method: 'PUT',
        body: { script: scriptText.value, name: name.value.trim() },
      })
      originalScript.value = scriptText.value
    }
    const res = await $fetch<{ items: Array<{ id: string; status: string; error?: string }> }>(
      '/api/sources/check',
      { method: 'POST', body: { ids: [props.source.id] } },
    )
    const summary = summarizeSourceCheck(res.items || [])
    if (summary.level === 'success') toast.success(summary.message)
    else if (summary.level === 'warning') toast.warning(summary.message)
    else toast.error(summary.message)
    emit('saved')
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '检测失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-backdrop" @click.self="onCancel">
      <div class="drawer form-drawer" role="dialog" aria-modal="true">
        <h3>{{ mode === 'edit' ? '编辑音源' : '单个新增' }}</h3>
        <p class="muted">
          需要 Key 的音源请在「脚本」中按作者说明直接修改后保存。密钥只保存在本地脚本文件中。
        </p>

        <label class="field">
          <span>名称</span>
          <input v-model="name" class="input" placeholder="例如：惠布克" :disabled="loading" />
        </label>

        <div class="tabs" role="tablist">
          <button
            type="button"
            class="tab"
            :class="{ active: sourceTab === 'url' }"
            :disabled="loading"
            @click="sourceTab = 'url'"
          >
            URL
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: sourceTab === 'upload' }"
            :disabled="loading"
            @click="sourceTab = 'upload'"
          >
            上传
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: sourceTab === 'script' }"
            :disabled="loading"
            @click="sourceTab = 'script'"
          >
            脚本
          </button>
        </div>

        <div v-show="sourceTab === 'url'" class="panel">
          <label class="field">
            <span>脚本 URL</span>
            <input
              v-model="url"
              class="input"
              placeholder="https://…/latest.js"
              :disabled="loading"
            />
          </label>
          <button
            v-if="mode === 'edit'"
            class="btn btn-ghost"
            type="button"
            style="margin-top: 8px"
            :disabled="loading || !url.trim()"
            @click="fetchUrlToScript"
          >
            从 URL 重新拉取并覆盖
          </button>
        </div>

        <div
          v-show="sourceTab === 'upload'"
          class="panel drop"
          :class="{ over: dragOver }"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop="onDrop"
        >
          <p class="muted">拖拽 .js 到此处，或选择文件 / 目录</p>
          <div class="actions">
            <button class="btn btn-ghost" type="button" :disabled="loading" @click="pickFiles">
              选择文件
            </button>
            <button class="btn btn-ghost" type="button" :disabled="loading" @click="pickDir">
              选择目录
            </button>
          </div>
          <p v-if="pendingFiles.length" class="muted" style="margin-top: 8px">
            已选 {{ pendingFiles.length }} 个文件
            <template v-if="pendingFiles.length === 1">：{{ pendingFiles[0]?.name }}</template>
          </p>
          <input
            ref="fileInput"
            type="file"
            accept=".js,text/javascript"
            multiple
            hidden
            @change="onFileChange"
          />
          <input
            ref="dirInput"
            type="file"
            multiple
            hidden
            webkitdirectory
            @change="onFileChange"
          />
        </div>

        <div v-show="sourceTab === 'script'" class="panel">
          <label class="field">
            <span>脚本内容（可直接修改 Key）</span>
            <textarea
              v-model="scriptText"
              class="textarea script"
              placeholder="// 音源脚本…"
              :disabled="loading"
              spellcheck="false"
            />
          </label>
        </div>

        <div class="actions" style="margin-top: 14px">
          <button class="btn" type="button" :disabled="loading" @click="doSave">
            {{ loading ? '处理中…' : '保存' }}
          </button>
          <button
            v-if="mode === 'edit'"
            class="btn btn-ghost"
            type="button"
            :disabled="loading"
            @click="doCheck"
          >
            检测
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">取消</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.form-drawer {
  width: min(640px, 96vw);
  max-height: 90vh;
  overflow: auto;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-top: 14px;
}
.tab {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}
.tab.active {
  border-color: var(--accent);
  color: var(--accent);
}
.panel {
  margin-top: 12px;
}
.drop {
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
}
.drop.over {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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
.script {
  min-height: 280px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.panel .actions {
  justify-content: center;
  margin-top: 8px;
}
</style>
