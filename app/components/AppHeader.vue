<script setup lang="ts">
const config = useRuntimeConfig()
const route = useRoute()
const { logout } = useAuth()
const { activeCount, startWatching } = useDownloadBadge()

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
    <button class="btn btn-ghost" type="button" @click="logout">退出</button>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand {
  font-weight: 700;
  color: var(--accent);
  min-width: 64px;
}
.nav {
  display: flex;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
}
.nav-link {
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
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
  background: var(--danger, #dc2626);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
</style>
