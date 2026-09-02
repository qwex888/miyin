<script setup lang="ts">
/**
 * 口令显/隐切换图标：visible=true 显示睁眼（明文），false 显示划线眼（密文）
 */
withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  { visible: false },
)
</script>

<template>
  <!-- 睁眼：当前为明文 -->
  <svg
    v-if="visible"
    class="password-visibility-ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
  <!-- 闭眼：当前为密文 -->
  <svg
    v-else
    class="password-visibility-ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </svg>
</template>

<style scoped>
.password-visibility-ico {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
