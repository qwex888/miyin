<script setup lang="ts">
const config = useRuntimeConfig()
const route = useRoute()
const { logout } = useAuth()
const { activeCount, startWatching } = useDownloadEvents()
const { mode, cycle } = useTheme()

const links = [
  { to: '/', label: '搜索' },
  { to: '/playlist', label: '歌单' },
  { to: '/queue', label: '下载队列', badge: true },
  { to: '/sources', label: '音源管理' },
  { to: '/settings', label: '设置' },
]

function active(to: string) {
  return route.path === to
}

const themeTitle = computed(() => {
  if (mode.value === 'light') return '浅色（点击切换）'
  if (mode.value === 'dark') return '深色（点击切换）'
  return '跟随系统（点击切换）'
})

onMounted(() => startWatching())
</script>

<template>
  <header class="header">
    <div class="brand">{{ config.public.appName }}</div>
    <nav class="nav">
      <NuxtLink
        v-for="l in links"
        :key="l.to"
        :to="l.to"
        class="nav-link"
        :class="{ active: active(l.to) }"
      >
        {{ l.label }}
        <span v-if="l.badge && activeCount > 0" class="badge">{{ activeCount > 99 ? '99+' : activeCount }}</span>
      </NuxtLink>
    </nav>
    <div class="header-actions">
      <button
        class="icon-btn"
        type="button"
        :title="themeTitle"
        :aria-label="themeTitle"
        @click="cycle"
      >
        <!-- sun -->
        <svg v-if="mode === 'light'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <!-- moon -->
        <svg v-else-if="mode === 'dark'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
        </svg>
        <!-- system / monitor -->
        <svg v-else class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      </button>
      <button class="btn btn-ghost btn-sm" type="button" @click="logout">退出</button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: color-mix(in oklab, var(--surface) 85%, transparent);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(10px);
}
.brand {
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--accent);
  min-width: 64px;
}
.nav {
  display: flex;
  gap: 4px;
  flex: 1;
  flex-wrap: wrap;
}
.nav-link {
  padding: 6px 10px;
  border-radius: calc(var(--radius) - 2px);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
  font-size: 14px;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.nav-link:hover {
  background: hsl(var(--secondary));
  color: var(--text);
}
.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: hsl(var(--destructive-foreground));
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
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
</style>
