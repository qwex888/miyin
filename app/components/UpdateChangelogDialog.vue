<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  manifest: {
    version: string
    tag: string
    releasedAt: string
    changelog: string
    downloads: {
      releasePage: string
      fpk?: string
      dockerHub?: string
      ghcr?: string
    }
  } | null
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const releasedLabel = computed(() => {
  const raw = props.manifest?.releasedAt
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
})

function onClose() {
  open.value = false
}

function onDismiss() {
  open.value = false
  emit('dismiss')
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
    <div v-if="open && manifest" class="overlay" role="presentation" @click.self="onClose">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-changelog-title"
      >
        <div class="head">
          <h2 id="update-changelog-title">发现新版本 {{ manifest.version }}</h2>
          <p v-if="releasedLabel" class="meta">发布于 {{ releasedLabel }}</p>
        </div>

        <div class="changelog-wrap">
          <pre class="changelog">{{ manifest.changelog }}</pre>
        </div>

        <div v-if="manifest.downloads.fpk" class="downloads">
          <a
            :href="manifest.downloads.fpk"
            target="_blank"
            rel="noopener noreferrer"
            class="link"
          >
            下载 FPK 安装包
          </a>
          <a
            :href="manifest.downloads.releasePage"
            target="_blank"
            rel="noopener noreferrer"
            class="link"
          >
            查看 GitHub Release
          </a>
        </div>

        <div class="footer">
          <button class="btn btn-ghost" type="button" @click="onDismiss">稍后再说</button>
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
  width: min(520px, 100%);
  max-height: min(85vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  padding: 20px;
  box-shadow: var(--shadow);
}
.head {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.head h2 {
  margin: 0;
  font-size: 1.15rem;
}
.meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.changelog-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg) 60%, transparent);
}
.changelog {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 14px;
}
.link {
  color: var(--accent);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
