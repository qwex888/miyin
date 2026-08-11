<script setup lang="ts">
type Settings = {
  downloadDir: string
  defaultQuality: string
  concurrency: number
  downloadLyric: boolean
  lyricMode: 'external' | 'embedded'
  nameTemplate: string
  autoFailover: boolean
  maxAttempts: number
  nameTemplateVars?: Array<{ key: string; desc: string }>
  ffmpegAvailable?: boolean
}

const form = reactive<Settings>({
  downloadDir: './downloads',
  defaultQuality: 'highest',
  concurrency: 1,
  downloadLyric: true,
  lyricMode: 'external',
  nameTemplate: '{artist} - {title}',
  autoFailover: true,
  maxAttempts: 3,
})
const templateVars = ref<Array<{ key: string; desc: string }>>([])
const ffmpegAvailable = ref<boolean | null>(null)
const formError = ref('')
const loading = ref(false)
const loadingText = ref('加载设置中…')
const toast = useToast()
const route = useRoute()
const fnosBox = ref<HTMLElement | null>(null)
const {
  status: fnosAuth,
  refresh: refreshFnOsAuth,
  pickAndAuthorize,
  authorizeCurrentPath,
  openSystemAppSetting,
  bindAuthMessage,
  ensureSdk,
} = useFnOsDirAuth()
let unbindAuth: (() => void) | null = null

const templatePreview = computed(() => {
  return form.nameTemplate
    .replaceAll('{artist}', '周杰伦')
    .replaceAll('{title}', '晴天')
    .replaceAll('{album}', '叶惠美')
    .replaceAll('{platform}', 'wy')
    .replaceAll('{quality}', '320k')
    .replaceAll('{id}', '186016')
    .replaceAll('{track}', '3')
})

async function load() {
  loadingText.value = '加载设置中…'
  loading.value = true
  try {
    const res = await $fetch<Settings>('/api/settings')
    Object.assign(form, {
      downloadDir: res.downloadDir,
      defaultQuality: res.defaultQuality,
      concurrency: res.concurrency,
      downloadLyric: res.downloadLyric,
      lyricMode: res.lyricMode || 'external',
      nameTemplate: res.nameTemplate,
      autoFailover: res.autoFailover,
      maxAttempts: res.maxAttempts,
    })
    templateVars.value = res.nameTemplateVars || []
    ffmpegAvailable.value = res.ffmpegAvailable ?? null
    await refreshFnOsAuth({ notifyError: true })
    if (fnosAuth.value?.downloadDir) form.downloadDir = fnosAuth.value.downloadDir
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载设置失败'))
  } finally {
    loading.value = false
  }
}

async function onPickAuthorize() {
  loadingText.value = '打开目录授权…'
  loading.value = true
  try {
    const res = await pickAndAuthorize()
    if (res?.downloadDir) form.downloadDir = res.downloadDir
    await refreshFnOsAuth({ notifyError: true })
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '选择授权失败'))
  } finally {
    loading.value = false
  }
}

async function onAuthorizeCurrent() {
  loadingText.value = '申请授权…'
  loading.value = true
  try {
    await authorizeCurrentPath(form.downloadDir)
    await refreshFnOsAuth({ notifyError: true })
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '授权失败'))
  } finally {
    loading.value = false
  }
}

async function onRefreshFnOs() {
  loadingText.value = '刷新授权状态…'
  loading.value = true
  try {
    await refreshFnOsAuth({ notifyError: true })
    if (fnosAuth.value?.downloadDir) form.downloadDir = fnosAuth.value.downloadDir
    if (!fnosAuth.value?.reason || fnosAuth.value.reason === 'non-fnos') {
      toast.success('已刷新授权状态')
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '刷新失败'))
  } finally {
    loading.value = false
  }
}

function scrollToFnOsBox() {
  nextTick(() => {
    fnosBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

async function save() {
  formError.value = ''
  loadingText.value = '保存中…'
  loading.value = true
  try {
    const res = await $fetch<Settings>('/api/settings', {
      method: 'PUT',
      body: {
        downloadDir: form.downloadDir,
        defaultQuality: form.defaultQuality,
        concurrency: form.concurrency,
        downloadLyric: form.downloadLyric,
        lyricMode: form.lyricMode,
        nameTemplate: form.nameTemplate,
        autoFailover: form.autoFailover,
        maxAttempts: form.maxAttempts,
      },
    })
    Object.assign(form, res)
    toast.success('设置已保存')
  } catch (e: unknown) {
    const m = apiErrorMessage(e, '保存失败')
    formError.value = m
    toast.error(m)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await ensureSdk()
  unbindAuth = bindAuthMessage(() => {
    void refreshFnOsAuth()
  })
  await load()
  if (route.query.fnosAuth === '1') scrollToFnOsBox()
})

onUnmounted(() => {
  unbindAuth?.()
  unbindAuth = null
})

useRegisterPageRefresh(async () => {
  await load()
})
</script>

<template>
  <div class="page">
    <PageLoading :show="loading" :text="loadingText" />
    <h2>设置</h2>
    <p class="hint auth-hint">
      鉴权由环境变量 <code>AUTH_TOKEN</code> 控制：为空则开放模式（无登录）；非空则需口令登录。飞牛安装向导可留空。
    </p>
    <form class="card form" @submit.prevent="save">
      <label>
        <span>下载目录</span>
        <input v-model="form.downloadDir" class="input" />
      </label>

      <div v-if="fnosAuth?.supported" ref="fnosBox" class="fnos-box">
        <p class="fnos-title">飞牛目录授权</p>
        <p class="hint">
          状态：
          <span :class="fnosAuth.authorized ? 'ok-inline' : 'warn'">
            {{ fnosAuth.authorized ? '已授权' : '未授权' }}
          </span>
          <template v-if="fnosAuth.downloadMode === 'custom'">（自定义路径）</template>
        </p>
        <p v-if="!fnosAuth.authorized" class="hint">
          自定义下载目录需管理员为应用授予读写权限。授权成功后请重启应用。
        </p>
        <div class="fnos-actions">
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onPickAuthorize">
            选择并授权目录
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onAuthorizeCurrent">
            授权当前路径
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onRefreshFnOs">
            刷新授权状态
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="openSystemAppSetting">
            打开系统应用设置
          </button>
        </div>
      </div>
      <label>
        <span>默认音质</span>
        <select v-model="form.defaultQuality" class="select">
          <option value="highest">最高可用（多源轮询+降级）</option>
          <option value="flac24bit">flac24bit（Hi-Res）</option>
          <option value="flac">flac（无损）</option>
          <option value="320k">320k</option>
          <option value="128k">128k</option>
        </select>
      </label>
      <label>
        <span>并发下载数</span>
        <input v-model.number="form.concurrency" class="input" type="number" min="1" max="5" />
      </label>

      <label>
        <span>文件命名模板</span>
        <input v-model="form.nameTemplate" class="input" />
        <p class="hint">预览：{{ templatePreview }}</p>
        <ul class="var-list">
          <li v-for="v in templateVars" :key="v.key">
            <code>{{ v.key }}</code> — {{ v.desc }}
          </li>
        </ul>
      </label>

      <label>
        <span>失败最大尝试次数</span>
        <input v-model.number="form.maxAttempts" class="input" type="number" min="1" max="8" />
      </label>

      <label class="check">
        <input v-model="form.downloadLyric" type="checkbox" />
        默认下载歌词
      </label>

      <label>
        <span>歌词写入方式</span>
        <select v-model="form.lyricMode" class="select" :disabled="!form.downloadLyric">
          <option value="external">仅外部 .lrc</option>
          <option value="embedded">仅内嵌到音频（需 ffmpeg）</option>
        </select>
        <p class="hint">
          网易云会尽量合并双语（原文 + 翻译/罗马音）。内嵌依赖本机 ffmpeg 写标签。
        </p>
        <p v-if="ffmpegAvailable === false" class="warn">
          当前环境未检测到 ffmpeg：内嵌歌词与封面元数据将跳过。飞牛 FPK 请先安装 ffmpeg。
        </p>
        <p v-else-if="ffmpegAvailable === true" class="ok-inline">已检测到 ffmpeg</p>
      </label>

      <label class="check">
        <input v-model="form.autoFailover" type="checkbox" />
        失败自动换源
      </label>
      <p v-if="formError" class="err">{{ formError }}</p>
      <button class="btn" type="submit" :disabled="loading">保存</button>
    </form>
  </div>
</template>

<style scoped>
.form {
  display: grid;
  gap: 14px;
  max-width: 560px;
}
.form label {
  display: grid;
  gap: 6px;
}
.check {
  display: flex !important;
  align-items: center;
  gap: 8px;
}
.ok {
  color: var(--accent);
  margin: 0;
}
.ok-inline {
  color: var(--accent);
  font-size: 12px;
  margin: 0;
}
.err {
  color: var(--danger);
  margin: 0;
}
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.auth-hint code {
  color: var(--accent);
}
.warn {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.var-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--muted);
}
.var-list code {
  color: var(--accent);
}
.fnos-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in oklab, var(--surface) 92%, var(--accent) 8%);
}
.fnos-title {
  margin: 0;
  font-weight: 600;
  font-size: 14px;
}
.fnos-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 768px) {
  .form {
    max-width: none;
  }
  .check {
    min-height: 44px;
  }
}
</style>
