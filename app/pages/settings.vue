<script setup lang="ts">
type Settings = {
  downloadDir: string
  defaultQuality: string
  concurrency: number
  downloadLyric: boolean
  nameTemplate: string
  autoFailover: boolean
  maxAttempts: number
}

const form = reactive<Settings>({
  downloadDir: './downloads',
  defaultQuality: 'highest',
  concurrency: 2,
  downloadLyric: true,
  nameTemplate: '{artist} - {title}',
  autoFailover: true,
  maxAttempts: 3,
})
const msg = ref('')
const error = ref('')

async function load() {
  const res = await $fetch<Settings>('/api/settings')
  Object.assign(form, res)
}

async function save() {
  msg.value = ''
  error.value = ''
  try {
    const res = await $fetch<Settings>('/api/settings', { method: 'PUT', body: { ...form } })
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
      </label>
      <label>
        <span>失败最大尝试次数</span>
        <input v-model.number="form.maxAttempts" class="input" type="number" min="1" max="8" />
      </label>
      <label class="check">
        <input v-model="form.downloadLyric" type="checkbox" />
        默认下载歌词
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
.err {
  color: var(--danger);
  margin: 0;
}
</style>
