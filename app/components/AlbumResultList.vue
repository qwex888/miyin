<script setup lang="ts">
export type SearchAlbumItem = {
  id: string
  externalId: string
  title: string
  artist: string
  trackCount?: number
  cover?: string
  platform: string
}

const props = defineProps<{
  items: SearchAlbumItem[]
  selectedId?: string | null
}>()

const emit = defineEmits<{
  select: [item: SearchAlbumItem]
}>()
</script>

<template>
  <div class="album-list">
    <div
      v-for="a in items"
      :key="a.id"
      class="row"
      :class="{ active: selectedId === a.id }"
      @click="emit('select', a)"
    >
      <CoverImage :src="a.cover" class="cover" :alt="a.title" />
      <div class="meta">
        <div class="title">{{ a.title }}</div>
        <div class="muted">
          {{ a.artist }}
          <span v-if="a.trackCount"> · {{ a.trackCount }} 首</span>
        </div>
      </div>
    </div>
    <p v-if="!items.length" class="muted empty">暂无专辑结果</p>
  </div>
</template>

<style scoped>
.album-list {
  padding: 8px;
}
.row {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
}
.row:hover,
.row.active {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}
.cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--accent-soft);
}
.title {
  font-weight: 600;
}
.empty {
  padding: 24px;
  text-align: center;
}
</style>
