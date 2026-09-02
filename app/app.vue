<script setup lang="ts">
const route = useRoute()
const config = useRuntimeConfig()
const pageSession = usePageSession()
const { dialogOpen, latest, deployMode, dismissUpdate } = useAppUpdate()

useHead({
  title: () => config.public.appName,
  link: [
    {
      rel: 'icon',
      type: 'image/svg+xml',
      href: () => {
        const base = config.app.baseURL || '/'
        return `${base.endsWith('/') ? base : `${base}/`}favicon.svg`
      },
    },
    {
      rel: 'apple-touch-icon',
      href: () => {
        const base = config.app.baseURL || '/'
        return `${base.endsWith('/') ? base : `${base}/`}logo-192.png`
      },
    },
  ],
  script: [
    {
      key: 'theme-init',
      // 优先读本地偏好，否则跟随系统，减少主题闪烁
      innerHTML:
        "(function(){try{var m=localStorage.getItem('miyin-theme');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()",
      tagPosition: 'head',
    },
  ],
})
</script>

<template>
  <div class="app-shell" :class="{ 'has-bottom-nav': route.path !== '/login' }">
    <AppHeader v-if="route.path !== '/login'" />
    <main class="app-main">
      <!-- 会话内 keepalive；退出登录 bump pageSession 销毁全部页面实例 -->
      <NuxtPage :key="pageSession" :keepalive="{ max: 10 }" />
    </main>
    <AppBottomNav v-if="route.path !== '/login'" />
    <AppToast />
    <UpdateChangelogDialog
      v-model:open="dialogOpen"
      :manifest="latest"
      :deploy-mode="deployMode"
      @dismiss="dismissUpdate"
    />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
/* 主内容区（body）：壳层内唯一页面级滚动容器 */
.app-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
/* 子页面至少撑满可视主区，便于队列等页 height:100% 内部滚动 */
.app-main > * {
  min-height: 100%;
  box-sizing: border-box;
}
</style>
