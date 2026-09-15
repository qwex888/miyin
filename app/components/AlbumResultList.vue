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

withDefaults(
  defineProps<{
    items: SearchAlbumItem[]
    selectedId?: string | null
    hasMore?: boolean
    loadingMore?: boolean
  }>(),
  {
    selectedId: null,
    hasMore: false,
    loadingMore: false,
  },
)

const emit = defineEmits<{
  select: [item: SearchAlbumItem]
  loadMore: []
}>()
</script>

<template>
  <div class="album-list">
    <VirtualList
      v-if="items.length"
      :items="items"
      :estimate-size="64"
      :has-more="hasMore"
      :loading="loadingMore"
      fill
      @load-more="emit('loadMore')"
    >
      <template #default="{ item }">
        <div
          class="row"
          :class="{ active: selectedId === item.id }"
          @click="emit('select', item)"
        >
          <CoverImage :src="item.cover" class="cover" :alt="item.title" />
          <div class="meta">
            <div class="title">{{ item.title }}</div>
            <div class="muted">
              {{ item.artist }}
              <span v-if="item.trackCount"> · {{ item.trackCount }} 首</span>
            </div>
          </div>
        </div>
      </template>
    </VirtualList>
    <p v-else class="muted empty">暂无专辑结果</p>
    <p v-if="loadingMore" class="muted list-footer">加载中…</p>
    <p v-else-if="items.length && !hasMore" class="muted list-footer">没有更多了</p>
  </div>
</template>

<style scoped>
.album-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
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
.list-footer {
  flex-shrink: 0;
  padding: 8px;
  text-align: center;
  font-size: 12px;
}
</style>
