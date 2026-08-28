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
const progressText = ref('')
const batchLogs = ref<Array<{ level?: string; message: string; name?: string }>>([])
const batchCompleted = ref(false)
const batchCompletedText = ref('处理完成')
let batchConfirmResolve: (() => void) | null = null
const name = ref('')
const sourceTab = ref<'url' | 'upload' | 'script'>('url')
const url = ref('')
const scriptText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const dragOver = ref(false)
const originalScript = ref('')

function resetBatchUi() {
  batchLogs.value = []
  batchCompleted.value = false
  batchCompletedText.value = '处理完成'
  batchConfirmResolve = null
}

function waitBatchConfirm(text: string) {
  batchCompletedText.value = text
  batchCompleted.value = true
  return new Promise<void>((resolve) => {
    batchConfirmResolve = resolve
  })
}

function onBatchConfirm() {
  batchConfirmResolve?.()
  batchConfirmResolve = null
  batchCompleted.value = false
  batchLogs.value = []
  loading.value = false
  progressText.value = ''
}

const showBatchLoading = computed(() => loading.value || batchCompleted.value)

watch(
  () => open.value,
  async (v) => {
    if (!v) return
    loading.value = false
    pendingFile.value = null
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

function pickFile() {
  fileInput.value?.click()
}

function takeSingleJs(list: FileList | File[] | null): File | null {
  if (!list?.length) return null
  const js = [...list].filter((f) => /\.js$/i.test(f.name))
  if (!js.length) return null
  if (js.length > 1) {
    toast.warning('单个新增仅支持 1 个文件，已选用第一个；批量请用「更多 → 批量导入目录（JS）」')
  }
  return js[0] || null
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = takeSingleJs(input.files)
  input.value = ''
  if (!file) {
    toast.warning('请选择 .js 音源文件')
    return
  }
  pendingFile.value = file
  if (!name.value.trim()) {
    name.value = file.name.replace(/\.js$/i, '')
  }
  void file.text().then((t) => {
    scriptText.value = t
  })
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const file = takeSingleJs(e.dataTransfer?.files || null)
  if (!file) {
    toast.warning('请拖入单个 .js 音源文件')
    return
  }
  sourceTab.value = 'upload'
  pendingFile.value = file
  if (!name.value.trim()) {
    name.value = file.name.replace(/\.js$/i, '')
  }
  void file.text().then((t) => {
    scriptText.value = t
  })
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
    if (sourceTab.value === 'upload' && pendingFile.value) {
      const text = scriptText.value || (await pendingFile.value.text())
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

    if (sourceTab.value === 'upload') {
      toast.warning('请先选择一个 .js 文件')
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
  resetBatchUi()
  loading.value = true
  progressText.value = '当前进度：准备检测…'
  try {
    if (scriptText.value && scriptText.value !== originalScript.value) {
      await $fetch(`/api/sources/${props.source.id}/script`, {
        method: 'PUT',
        body: { script: scriptText.value, name: name.value.trim() },
      })
      originalScript.value = scriptText.value
    }
    const done = await fetchSourceBatchNdjson(
      '/api/sources/check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [props.source.id], stream: true }),
      },
      {
        onProgress: (text) => {
          progressText.value = text
        },
        onLog: (event) => {
          batchLogs.value.push({
            level: event.level,
            message: event.message,
            name: event.name,
          })
        },
      },
    )
    const summary = summarizeSourceCheck(done.items || [])
    if (summary.level === 'success') toast.success(summary.message)
    else if (summary.level === 'warning') toast.warning(summary.message)
    else toast.error(summary.message)
    emit('saved')
    await waitBatchConfirm(summary.message)
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '检测失败'))
    loading.value = false
    progressText.value = ''
    resetBatchUi()
  }
}
</script>

<template>
  <Teleport to="body">
    <PageLoading
      :show="showBatchLoading && !!progressText"
      :text="progressText || '处理中…'"
      :logs="batchLogs"
      :completed="batchCompleted"
      :completed-text="batchCompletedText"
      @confirm="onBatchConfirm"
    />
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
          <p class="muted">拖拽单个 .js 到此处，或选择文件</p>
          <div class="actions">
            <button class="btn btn-ghost" type="button" :disabled="loading" @click="pickFile">
              选择文件
            </button>
          </div>
          <p v-if="pendingFile" class="muted" style="margin-top: 8px">
            已选：{{ pendingFile.name }}
          </p>
          <input
            ref="fileInput"
            type="file"
            accept=".js,text/javascript"
            hidden
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
        <p v-if="progressText && !showBatchLoading" class="muted progress-line">{{ progressText }}</p>
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
.progress-line {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-all;
}
</style>
