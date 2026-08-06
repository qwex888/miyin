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
    /** 按内容实测行高（路径换行、多行文案时用） */
    dynamic?: boolean
  }>(),
  {
    estimateSize: 64,
    overscan: 8,
    maxHeight: '480px',
    fill: false,
    dynamic: false,
  },
)

const parentRef = ref<HTMLElement | null>(null)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => props.estimateSize,
    overscan: props.overscan,
    ...(props.dynamic
      ? {
          measureElement:
            typeof window !== 'undefined'
              ? (el: Element | null | undefined) =>
                  (el as HTMLElement | null | undefined)?.getBoundingClientRect().height ?? props.estimateSize
              : undefined,
        }
      : {}),
  })),
)

const totalSize = computed(() => virtualizer.value.getTotalSize())
const virtualItems = computed(() => virtualizer.value.getVirtualItems())

function setRowRef(el: Element | null, index: number) {
  if (!props.dynamic || !el) return
  ;(el as HTMLElement).dataset.index = String(index)
  virtualizer.value.measureElement(el)
}
</script>

<template>
  <div
    ref="parentRef"
    class="virtual-list"
    :class="{ fill, dynamic }"
    :style="fill ? { height: '100%', maxHeight: '100%' } : { maxHeight }"
  >
    <div class="virtual-inner" :style="{ height: `${totalSize}px` }">
      <div
        v-for="v in virtualItems"
        :key="String(v.key)"
        class="virtual-row"
        :data-index="v.index"
        :ref="(el) => setRowRef(el as Element | null, v.index)"
        :style="{
          transform: `translateY(${v.start}px)`,
          ...(dynamic ? {} : { height: `${v.size}px` }),
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
}
.virtual-list:not(.dynamic) .virtual-row {
  overflow: hidden;
}
</style>
