<script setup lang="ts">
const url = ref('')
const loading = ref(false)
const msg = ref('')
const error = ref('')
const preview = ref<{ title: string; tracks: any[] } | null>(null)
const result = ref<any>(null)

async function parseOnly() {
  error.value = ''
  msg.value = ''
  result.value = null
  loading.value = true
  try {
    const res = await $fetch<{ title: string; tracks: any[]; platform: string }>('/api/playlist/parse', {
      method: 'POST',
      body: { url: url.value },
    })
    preview.value = res
    msg.value = `解析成功：${res.title}，共 ${res.tracks.length} 首`
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '解析失败'
    preview.value = null
  } finally {
    loading.value = false
  }
}

async function enqueueAll() {
  error.value = ''
  msg.value = ''
  loading.value = true
  try {
    const res = await $fetch('/api/playlist/enqueue', {
      method: 'POST',
      body: { url: url.value, downloadLyric: true, quality: 'highest' },
    })
    result.value = res
    msg.value = `已入队 ${res.enqueued}/${res.total}，批次 ${res.batchId}`
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '入队失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <h2>歌单导入</h2>
    <p class="muted">粘贴网易云歌单链接，解析曲目后按「ID 优先 + 元数据回退」匹配并批量入队。</p>
    <div class="row">
      <input v-model="url" class="input" placeholder="https://music.163.com/#/playlist?id=..." />
      <button class="btn btn-ghost" type="button" :disabled="loading || !url.trim()" @click="parseOnly">
        仅解析
      </button>
      <button class="btn" type="button" :disabled="loading || !url.trim()" @click="enqueueAll">
        解析并下载
      </button>
    </div>
    <p v-if="msg" class="ok">{{ msg }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="preview" class="card" style="margin-top: 16px">
      <h3>{{ preview.title }}</h3>
      <p class="muted">预览前 {{ Math.min(20, preview.tracks.length) }} 首</p>
      <ul class="list">
        <li v-for="(t, i) in preview.tracks.slice(0, 20)" :key="i">
          {{ t.title }} · {{ t.artist }}
        </li>
      </ul>
    </div>

    <div v-if="result" class="card" style="margin-top: 16px">
      <h3>入队结果</h3>
      <p>成功 {{ result.enqueued }} / {{ result.total }}</p>
      <ul class="list">
        <li v-for="(r, i) in result.results.slice(0, 30)" :key="i">
          <span :class="r.ok ? 'ok' : 'err'">{{ r.ok ? '✓' : '✗' }}</span>
          {{ r.title }}
          <span v-if="r.method" class="muted">（{{ r.method }}）</span>
          <span v-if="r.error" class="err">{{ r.error }}</span>
        </li>
      </ul>
      <NuxtLink to="/queue" class="btn" style="margin-top: 12px; display: inline-flex">查看队列</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.row .input {
  flex: 1;
  min-width: 240px;
}
.ok {
  color: var(--accent);
}
.err {
  color: var(--danger);
}
.list {
  margin: 0;
  padding-left: 18px;
  max-height: 360px;
  overflow: auto;
}
</style>
