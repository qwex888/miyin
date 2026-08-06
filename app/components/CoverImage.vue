<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    src?: string | null
    lazy?: boolean
    alt?: string
    imgClass?: string
  }>(),
  {
    lazy: true,
    alt: '',
    imgClass: '',
  },
)

type CoverState = 'idle' | 'loading' | 'loaded' | 'error'

const rootRef = ref<HTMLElement | null>(null)
const shouldFetch = ref(!props.lazy)
const hasSrc = computed(() => !!props.src)
const state = ref<CoverState>(hasSrc.value ? 'loading' : 'idle')
const coverUrl = computed(() => (shouldFetch.value && hasSrc.value ? props.src || '' : ''))

let io: IntersectionObserver | null = null

onMounted(() => {
  if (!props.lazy) {
    shouldFetch.value = true
    return
  }
  const el = rootRef.value
  if (!el || typeof IntersectionObserver === 'undefined') {
    shouldFetch.value = true
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        shouldFetch.value = true
        io?.disconnect()
        io = null
      }
    },
    { rootMargin: '150px', threshold: 0.01 },
  )
  io.observe(el)
})

onUnmounted(() => {
  io?.disconnect()
  io = null
})

watch(
  () => props.src,
  () => {
    state.value = hasSrc.value ? 'loading' : 'idle'
  },
)

function onLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.src.startsWith('data:')) return
  state.value = 'loaded'
}

function onError(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.src.startsWith('data:')) return
  state.value = 'error'
}
</script>

<template>
  <div ref="rootRef" class="cover-image">
    <img
      v-if="coverUrl && state !== 'error'"
      :src="coverUrl"
      :class="['cover-img', imgClass, { 'is-loaded': state === 'loaded' }]"
      :alt="alt"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />

    <div v-if="state === 'loading'" class="cover-placeholder shimmer" aria-hidden="true">
      <svg class="icon" fill="currentColor" viewBox="0 0 24 24">
        <path
          d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
        />
      </svg>
    </div>

    <div v-if="state === 'error' || state === 'idle'" class="cover-placeholder" aria-hidden="true">
      <svg class="icon muted" fill="currentColor" viewBox="0 0 24 24">
        <path
          d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.cover-image {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease-in;
  position: relative;
  z-index: 1;
}

.cover-img.is-loaded {
  opacity: 1;
}

.cover-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  z-index: 0;
}

.icon {
  width: 20px;
  height: 20px;
  opacity: 0.35;
}

.icon.muted {
  opacity: 0.4;
}

.shimmer {
  background-image: linear-gradient(
    90deg,
    rgba(229, 231, 235, 0.7) 0px,
    rgba(243, 244, 246, 0.95) 40px,
    rgba(229, 231, 235, 0.7) 80px
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite linear;
}

@keyframes shimmer {
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: 200px 0;
  }
}
</style>
