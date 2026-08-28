<script setup lang="ts">
const config = useRuntimeConfig()

const menuOpen = ref(false)
const aboutOpen = ref(false)

const feedbackUrl = computed(() =>
  String(config.public.feedbackUrl || 'https://github.com/qwex888/miyin/issues/new'),
)

function closeMenu() {
  menuOpen.value = false
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function openAbout() {
  closeMenu()
  aboutOpen.value = true
}

function openFeedback() {
  closeMenu()
  if (import.meta.client) {
    window.open(feedbackUrl.value, '_blank', 'noopener,noreferrer')
  }
}

function onDocClick() {
  closeMenu()
}

onMounted(() => window.addEventListener('click', onDocClick))
onBeforeUnmount(() => window.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="help-wrap">
    <button
      class="icon-btn"
      type="button"
      title="帮助与反馈"
      aria-label="帮助与反馈"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click.stop="toggleMenu"
    >
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" stroke-linecap="round" />
        <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    </button>

    <div v-if="menuOpen" class="help-panel" role="menu" @click.stop>
      <button type="button" role="menuitem" @click="openAbout">关于觅音</button>
      <button type="button" role="menuitem" @click="openFeedback">问题反馈 / 建议</button>
    </div>

    <AboutMiyinDialog v-model:open="aboutOpen" />
  </div>
</template>

<style scoped>
.help-wrap {
  position: relative;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.icon-btn:hover {
  background: hsl(var(--secondary));
}
.ico {
  width: 16px;
  height: 16px;
}
.help-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 168px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.help-panel button {
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.help-panel button:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
</style>
