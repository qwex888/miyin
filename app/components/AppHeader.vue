<script setup lang="ts">
import { APP_NAV_LINKS, navLinkActive } from '~/utils/nav'

const route = useRoute()
const { logout, authRequired } = useAuth()
const { activeCount, startWatching } = useDownloadEvents()
const { mode, cycle } = useTheme()
const { canRefresh, busy: refreshBusy, refreshCurrentPage } = usePageRefreshAction()
const toast = useToast()

const themeTitle = computed(() => {
  if (mode.value === 'light') return '浅色（点击切换）'
  if (mode.value === 'dark') return '深色（点击切换）'
  return '跟随系统（点击切换）'
})

async function onLogout() {
  await logout()
  toast.info('已退出登录')
}

onMounted(() => startWatching())
</script>

<template>
  <header class="header">
    <NuxtLink to="/" class="brand-link" aria-label="觅音首页">
      <span class="brand-full">
        <BrandLogo :size="28" />
      </span>
      <span class="brand-compact">
        <BrandLogo :size="28" :with-name="false" />
      </span>
    </NuxtLink>
    <nav class="nav desktop-nav">
      <NuxtLink
        v-for="l in APP_NAV_LINKS"
        :key="l.to"
        :to="l.to"
        class="nav-link"
        :class="{ active: navLinkActive(route.path, l.to) }"
      >
        {{ l.label }}
        <span v-if="l.badge && activeCount > 0" class="badge">{{ activeCount > 99 ? '99+' : activeCount }}</span>
      </NuxtLink>
    </nav>
    <div class="header-actions">
      <button
        v-if="canRefresh"
        class="icon-btn"
        type="button"
        title="刷新当前页"
        aria-label="刷新当前页"
        :disabled="refreshBusy"
        @click="refreshCurrentPage"
      >
        <svg
          class="ico"
          :class="{ spin: refreshBusy }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 12a9 9 0 1 1-2.6-6.3" stroke-linecap="round" />
          <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="icon-btn"
        type="button"
        :title="themeTitle"
        :aria-label="themeTitle"
        @click="cycle"
      >
        <svg v-if="mode === 'light'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg v-else-if="mode === 'dark'" class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
        </svg>
        <svg v-else class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      </button>
      <button v-if="authRequired" class="btn btn-ghost btn-sm logout-btn" type="button" @click="onLogout">
        退出
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
  background: color-mix(in oklab, var(--surface) 85%, transparent);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}
.brand-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.brand-compact {
  display: none;
}
.nav {
  display: flex;
  gap: 4px;
  flex: 1;
  flex-wrap: wrap;
  min-width: 0;
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
  min-height: 36px;
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
  margin-left: auto;
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
.icon-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ico {
  width: 16px;
  height: 16px;
}
.ico.spin {
  animation: header-refresh-spin 0.7s linear infinite;
}
@keyframes header-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .header {
    gap: 8px;
    padding: 8px 12px;
    padding-top: calc(8px + env(safe-area-inset-top, 0px));
  }
  .desktop-nav {
    display: none;
  }
  .brand-full {
    display: none;
  }
  .brand-compact {
    display: inline-flex;
  }
  .logout-btn {
    padding-inline: 10px;
    min-height: 40px;
  }
}
</style>
