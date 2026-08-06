<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <div>
    <AppHeader v-if="route.path !== '/login'" />
    <NuxtPage />
  </div>
</template>
