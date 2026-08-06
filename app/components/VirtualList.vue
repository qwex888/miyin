<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'

const props = withDefaults(
  defineProps<{
    items: unknown[]
    estimateSize?: number
    overscan?: number
    maxHeight?: string
    /** 填满父级高度（父级需有明确高度，如 flex:1） */
    fill?: boolean
  }>(),
  {
    estimateSize: 64,
    overscan: 8,
    maxHeight: '480px',
    fill: false,
  },
)

const parentRef = ref<HTMLElement | null>(null)

// @tanstack/vue-virtual 需要 Ref/Computed；传入裸函数时 unref 无法展开，getScrollElement 会丢失
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => props.estimateSize,
    overscan: props.overscan,
  })),
)

const totalSize = computed(() => virtualizer.value.getTotalSize())
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
</script>

<template>
  <div
    ref="parentRef"
    class="virtual-list"
    :class="{ fill }"
    :style="fill ? { height: '100%', maxHeight: '100%' } : { maxHeight }"
  >
    <div class="virtual-inner" :style="{ height: `${totalSize}px` }">
      <div
        v-for="v in virtualItems"
        :key="String(v.key)"
        class="virtual-row"
        :style="{
          transform: `translateY(${v.start}px)`,
          height: `${v.size}px`,
        }"
      >
        <slot :item="(items as any[])[v.index]" :index="v.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-list {
  overflow: auto;
  width: 100%;
  position: relative;
}
.virtual-list.fill {
  flex: 1;
  min-height: 0;
}
.virtual-inner {
  width: 100%;
  position: relative;
}
.virtual-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  overflow: hidden;
}
</style>
