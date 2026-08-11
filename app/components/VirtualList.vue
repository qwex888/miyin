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
                  (el as HTMLElement | null | undefined)?.getBoundingClientRect().height ??
                  props.estimateSize
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

/** KeepAlive 切回 / 容器尺寸变化时强制重测，避免可见行为空 */
function remeasureViewport() {
  const el = parentRef.value
  if (!el) return
  virtualizer.value.measure()
  // 轻推滚动触发 getVirtualItems 重算（切页后常见 scrollHeight 已就绪但未刷新）
  const top = el.scrollTop
  el.scrollTop = top + 0.5
  el.scrollTop = top
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => remeasureViewport())
  if (parentRef.value) resizeObserver.observe(parentRef.value)
})

watch(parentRef, (el, prev) => {
  if (!resizeObserver) return
  if (prev) resizeObserver.unobserve(prev)
  if (el) {
    resizeObserver.observe(el)
    nextTick(() => remeasureViewport())
  }
})

onActivated(() => {
  nextTick(() => remeasureViewport())
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
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
