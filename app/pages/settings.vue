<script setup lang="ts">
type Settings = {
  downloadDir: string
  defaultQuality: string
  concurrency: number
  taskStartIntervalSec: number
  downloadIntervalSec: number
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
  taskStartIntervalSec: 0,
  downloadIntervalSec: 0,
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
const { refresh: refreshAuth } = useAuth()
const settingsTab = ref<'basic' | 'auth'>('basic')

type AuthTokenStatus = {
  authRequired: boolean
  hasOverride: boolean
  source: 'settings' | 'env'
  runtime: 'fnos' | 'standard'
}

const authStatus = ref<AuthTokenStatus | null>(null)
const authForm = reactive({
  currentToken: '',
  newToken: '',
  confirmToken: '',
})
const showCurrentToken = ref(false)
const showNewToken = ref(false)
const showConfirmToken = ref(false)
const authFormError = ref('')
const {
  currentVersion,
  latest,
  checking,
  showBadge,
  checkForUpdate,
  openChangelog,
  consumePendingOpen,
} = useAppUpdate()
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

async function onCheckUpdate() {
  loadingText.value = '检查更新中…'
  loading.value = true
  try {
    const res = await checkForUpdate(true)
    if (res?.hasUpdate && res.latest) {
      openChangelog()
    } else {
      toast.success('当前已是最新版本')
    }
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '检查更新失败'))
  } finally {
    loading.value = false
  }
}

async function load() {
  loadingText.value = '加载设置中…'
  loading.value = true
  try {
    const res = await $fetch<Settings>('/api/settings')
    Object.assign(form, {
      downloadDir: res.downloadDir,
      defaultQuality: res.defaultQuality,
      concurrency: res.concurrency,
      taskStartIntervalSec: res.taskStartIntervalSec ?? 0,
      downloadIntervalSec: res.downloadIntervalSec ?? 0,
      downloadLyric: res.downloadLyric,
      lyricMode: res.lyricMode || 'external',
      nameTemplate: res.nameTemplate,
      autoFailover: res.autoFailover,
      maxAttempts: res.maxAttempts,
    })
    templateVars.value = res.nameTemplateVars || []
    ffmpegAvailable.value = res.ffmpegAvailable ?? null
    await loadAuthStatus()
    await refreshFnOsAuth({ notifyError: true })
    if (fnosAuth.value?.downloadDir) form.downloadDir = fnosAuth.value.downloadDir
  } catch (e: unknown) {
    toast.error(apiErrorMessage(e, '加载设置失败'))
  } finally {
    loading.value = false
  }
}

async function loadAuthStatus() {
  try {
    authStatus.value = await $fetch<AuthTokenStatus>('/api/auth/token')
  } catch {
    authStatus.value = null
  }
}

async function saveAuthToken() {
  authFormError.value = ''
  if (authForm.newToken !== authForm.confirmToken) {
    authFormError.value = '两次输入的新口令不一致'
    toast.error(authFormError.value)
    return
  }
  loadingText.value = '更新口令中…'
  loading.value = true
  try {
    const res = await $fetch<{
      ok: boolean
      message?: string
      warning?: string
      authRequired: boolean
      restartRequired?: boolean
    }>('/api/auth/token', {
      method: 'PUT',
      body: {
        currentToken: authForm.currentToken,
        newToken: authForm.newToken,
        confirmToken: authForm.confirmToken,
      },
    })
    authForm.currentToken = ''
    authForm.newToken = ''
    authForm.confirmToken = ''
    await loadAuthStatus()
    await refreshAuth()
    if (res.warning) toast.warning(res.warning)
    else toast.success(res.message || '口令已更新')
  } catch (e: unknown) {
    const m = apiErrorMessage(e, '更新口令失败')
    authFormError.value = m
    toast.error(m)
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
        taskStartIntervalSec: form.taskStartIntervalSec,
        downloadIntervalSec: form.downloadIntervalSec,
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
  if (consumePendingOpen() && showBadge.value) openChangelog()
  if (route.query.fnosAuth === '1') {
    settingsTab.value = 'basic'
    scrollToFnOsBox()
  }
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
  <div class="page page-settings">
    <PageLoading :show="loading" :text="loadingText" />
    <div class="tabs" role="tablist" aria-label="设置分类">
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: settingsTab === 'basic' }"
        :aria-selected="settingsTab === 'basic'"
        @click="settingsTab = 'basic'"
      >
        基础设置
      </button>
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: settingsTab === 'auth' }"
        :aria-selected="settingsTab === 'auth'"
        @click="settingsTab = 'auth'"
      >
        访问口令
      </button>
    </div>

    <template v-if="settingsTab === 'basic'">
    <section class="card version-card">
      <div class="version-row">
        <div>
          <p class="version-label">当前版本</p>
          <p class="version-value">v{{ currentVersion }}</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="checking || loading" @click="onCheckUpdate">
          {{ checking ? '检查中…' : '检查更新' }}
        </button>
      </div>
      <button
        v-if="showBadge && latest"
        type="button"
        class="update-banner"
        @click="openChangelog"
      >
        <span class="update-dot" aria-hidden="true" />
        发现新版本 v{{ latest.version }}，点击查看更新说明
      </button>
    </section>
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
        <span>任务启动间隔（秒）</span>
        <input
          v-model.number="form.taskStartIntervalSec"
          class="input"
          type="number"
          min="0"
          max="120"
        />
        <p class="hint">
          两次「开始下载」至少间隔这么久（0=关闭）。并发大于 1 时用来错开启动/取链，减轻短时连打。
        </p>
      </label>
      <label>
        <span>下载间隔（秒）</span>
        <input
          v-model.number="form.downloadIntervalSec"
          class="input"
          type="number"
          min="0"
          max="120"
        />
        <p class="hint">
          上一首任务结束后（成功/失败/取消），再等待这么久才启动下一首（0=关闭）。批量防风控建议并发
          1，并设 2～5 秒。
        </p>
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
          各平台会尽量合并双语歌词。内嵌依赖本机 ffmpeg 写标签。
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
    </template>

    <section v-else class="card auth-card">
      <p class="hint">
        当前：
        <span :class="authStatus?.authRequired ? 'warn' : 'ok-inline'">
          {{ authStatus?.authRequired ? '已启用鉴权' : '开放模式（免登录）' }}
        </span>
        <template v-if="authStatus">
          · 来源 {{ authStatus.source === 'settings' ? '应用内设置' : '环境变量 / 安装配置' }}
          <template v-if="authStatus.runtime === 'fnos'"> · 飞牛 FPK</template>
        </template>
      </p>
      <p class="hint">
        修改后立即生效（无需重启）。优先级：应用内设置 &gt; Docker
        <code>-e AUTH_TOKEN</code> / 飞牛安装向导。留空新口令可切回开放模式。
      </p>
      <form class="auth-form" @submit.prevent="saveAuthToken">
        <label>
          <span>当前口令{{ authStatus && !authStatus.authRequired ? '（开放模式请留空）' : '' }}</span>
          <div class="token-wrap">
            <input
              v-model="authForm.currentToken"
              class="input token-input"
              :type="showCurrentToken ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="当前口令"
            />
            <button
              class="token-toggle"
              type="button"
              :title="showCurrentToken ? '隐藏' : '显示'"
              :aria-label="showCurrentToken ? '隐藏当前口令' : '显示当前口令'"
              @click="showCurrentToken = !showCurrentToken"
            >
              <PasswordVisibilityIcon :visible="showCurrentToken" />
            </button>
          </div>
        </label>
        <label>
          <span>新口令（可留空=开放模式）</span>
          <div class="token-wrap">
            <input
              v-model="authForm.newToken"
              class="input token-input"
              :type="showNewToken ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="新口令"
            />
            <button
              class="token-toggle"
              type="button"
              :title="showNewToken ? '隐藏' : '显示'"
              :aria-label="showNewToken ? '隐藏新口令' : '显示新口令'"
              @click="showNewToken = !showNewToken"
            >
              <PasswordVisibilityIcon :visible="showNewToken" />
            </button>
          </div>
        </label>
        <label>
          <span>确认新口令</span>
          <div class="token-wrap">
            <input
              v-model="authForm.confirmToken"
              class="input token-input"
              :type="showConfirmToken ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再输入一次新口令"
            />
            <button
              class="token-toggle"
              type="button"
              :title="showConfirmToken ? '隐藏' : '显示'"
              :aria-label="showConfirmToken ? '隐藏确认口令' : '显示确认口令'"
              @click="showConfirmToken = !showConfirmToken"
            >
              <PasswordVisibilityIcon :visible="showConfirmToken" />
            </button>
          </div>
        </label>
        <p v-if="authFormError" class="err">{{ authFormError }}</p>
        <button class="btn" type="submit" :disabled="loading">更新口令</button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 20px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
  max-width: 560px;
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
.tab.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.version-card {
  display: grid;
  gap: 12px;
  max-width: 560px;
  margin-bottom: 14px;
  padding: 16px;
}
.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.version-label {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.version-value {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
}
.update-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.update-banner:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.update-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
.form {
  display: grid;
  gap: 14px;
  max-width: 560px;
}
.auth-card {
  display: grid;
  gap: 12px;
  max-width: 560px;
  padding: 16px;
}
.auth-form {
  display: grid;
  gap: 12px;
}
.auth-form label {
  display: grid;
  gap: 6px;
}
.token-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.token-input {
  width: 100%;
  padding-right: 42px;
}
.token-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
}
.token-toggle:hover {
  color: var(--text);
  background: hsl(var(--secondary));
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
  .tabs {
    max-width: none;
    gap: 0;
  }
  .tab {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 10px 2px;
    text-align: center;
    font-size: 13px;
  }
  .form {
    max-width: none;
  }
  .auth-card {
    max-width: none;
  }
  .check {
    min-height: 44px;
  }
}
</style>
