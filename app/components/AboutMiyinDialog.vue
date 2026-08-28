<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const config = useRuntimeConfig()

const repoUrl = computed(() => String(config.public.repoUrl || 'https://github.com/qwex888/miyin'))
const releasesUrl = computed(() => `${repoUrl.value}/releases`)
const version = computed(() => String(config.public.appVersion || ''))

function onClose() {
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') onClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" role="presentation" @click.self="onClose">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-miyin-title"
      >
        <div class="hero">
          <BrandLogo :size="48" />
          <h2 id="about-miyin-title" class="title">{{ config.public.appName }}</h2>
          <p v-if="version" class="version">版本 {{ version }}</p>
        </div>

        <p class="desc">
          轻量音乐下载助手：多源搜索、试听、指定音质下载与音源管理。支持 Docker 与飞牛 fnOS 部署。
        </p>

        <div class="links">
          <a :href="repoUrl" target="_blank" rel="noopener noreferrer">GitHub 仓库</a>
          <span class="sep">·</span>
          <a :href="releasesUrl" target="_blank" rel="noopener noreferrer">更新日志 / Releases</a>
        </div>

        <p class="license muted">开源协议：MIT</p>

        <div class="footer">
          <button class="btn" type="button" @click="onClose">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in oklab, #0f172a 40%, transparent);
  backdrop-filter: blur(2px);
}
.dialog {
  width: min(420px, 100%);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  padding: 24px 20px 16px;
  box-shadow: var(--shadow);
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  margin-bottom: 16px;
}
.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}
.version {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.desc {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
}
.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
  margin-bottom: 10px;
}
.links a {
  color: var(--accent);
  text-decoration: none;
}
.links a:hover {
  text-decoration: underline;
}
.sep {
  color: var(--muted);
}
.license {
  margin: 0 0 16px;
  text-align: center;
  font-size: 12px;
}
.footer {
  display: flex;
  justify-content: center;
}
</style>
