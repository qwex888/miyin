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
  concurrency: 2,
  downloadLyric: true,
  lyricMode: 'external',
  nameTemplate: '{artist} - {title}',
  autoFailover: true,
  maxAttempts: 3,
})
const templateVars = ref<Array<{ key: string; desc: string }>>([])
const ffmpegAvailable = ref<boolean | null>(null)
const msg = ref('')
const error = ref('')

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
}

async function save() {
  msg.value = ''
  error.value = ''
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
    msg.value = '已保存'
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '保存失败'
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <h2>设置</h2>
    <form class="card form" @submit.prevent="save">
      <label>
        <span>下载目录</span>
        <input v-model="form.downloadDir" class="input" />
      </label>
      <label>
        <span>默认音质</span>
        <select v-model="form.defaultQuality" class="select">
          <option value="highest">最高可用</option>
          <option value="flac">flac</option>
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
      <p v-if="msg" class="ok">{{ msg }}</p>
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit">保存</button>
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
  margin: 0;
  font-size: 12px;
  color: var(--muted);
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
</style>
