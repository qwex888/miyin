<script setup lang="ts">
const route = useRoute()

useHead({
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
  <div class="app-shell">
    <AppHeader v-if="route.path !== '/login'" />
    <main class="app-main">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
.app-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
