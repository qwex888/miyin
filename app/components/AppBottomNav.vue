<script setup lang="ts">
import { APP_NAV_LINKS, navLinkActive } from '~/utils/nav'

const route = useRoute()
const { activeCount } = useDownloadEvents()
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <NuxtLink
      v-for="l in APP_NAV_LINKS"
      :key="l.to"
      :to="l.to"
      class="tab"
      :class="{ active: navLinkActive(route.path, l.to) }"
    >
      <span class="label">{{ l.short }}</span>
      <span v-if="l.badge && activeCount > 0" class="badge">{{ activeCount > 99 ? '99+' : activeCount }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: none;
  position: sticky;
  bottom: 0;
  z-index: 30;
  flex-shrink: 0;
  grid-template-columns: repeat(5, 1fr);
  gap: 2px;
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  background: color-mix(in oklab, var(--surface) 92%, transparent);
  border-top: 1px solid var(--border);
  backdrop-filter: blur(12px);
}
.tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 4px 2px;
  border-radius: calc(var(--radius) - 2px);
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.tab.active {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 700;
}
.label {
  line-height: 1.2;
  text-align: center;
}
.badge {
  position: absolute;
  top: 2px;
  right: max(2px, 12%);
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger);
  color: hsl(var(--destructive-foreground));
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

@media (max-width: 768px) {
  .bottom-nav {
    display: grid;
  }
}
</style>
