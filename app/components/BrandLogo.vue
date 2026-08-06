<script setup lang="ts">
/**
 * 觅音品牌标：概念二「M 波下探」
 * 浅色 logo.svg / 深色 logo-dark.svg（随主题 isDark 切换）
 * 资源位于 public/，路径需带上 app.baseURL（飞牛网关 /app/miyin/）
 */
const props = withDefaults(
  defineProps<{
    size?: number | string
    withName?: boolean
  }>(),
  {
    size: 28,
    withName: true,
  },
)

const config = useRuntimeConfig()
const { isDark } = useTheme()

const assetBase = computed(() => {
  const base = config.app.baseURL || '/'
  return base.endsWith('/') ? base : `${base}/`
})

const src = computed(() => `${assetBase.value}${isDark.value ? 'logo-dark.svg' : 'logo.svg'}`)

const px = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) ? `${n}px` : String(props.size)
})
</script>

<template>
  <div class="brand-logo" :class="{ 'with-name': withName }">
    <img
      class="mark"
      :src="src"
      alt=""
      :width="size"
      :height="size"
      :style="{ width: px, height: px }"
    />
    <span v-if="withName" class="name">{{ config.public.appName }}</span>
  </div>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--accent);
}
.mark {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
.name {
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 16px;
  line-height: 1;
  white-space: nowrap;
}
</style>
