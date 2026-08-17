<script setup lang="ts">
export type ImportConflict = {
  id: string
  name: string
  url: string
  existingId: string
  existingName: string
  reason: 'id' | 'url' | 'name'
}

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    conflictCount?: number
    newCount?: number
    conflicts?: ImportConflict[]
    loading?: boolean
    /** 冲突说明文案；默认覆盖完整包场景 */
    description?: string
  }>(),
  {
    conflictCount: 0,
    newCount: 0,
    conflicts: () => [],
    loading: false,
    description: '',
  },
)

const emit = defineEmits<{
  resolve: [action: 'overwrite' | 'skip']
  cancel: []
}>()

const descriptionText = computed(() => {
  if (props.description) return props.description
  return `有 ${props.conflictCount} 个与现有音源冲突，另有 ${props.newCount} 个可直接新增。请选择对冲突项的处理方式：`
})

function reasonLabel(reason: ImportConflict['reason']) {
  if (reason === 'id') return 'ID'
  if (reason === 'url') return 'URL'
  return '同名'
}

function onCancel() {
  if (props.loading) return
  open.value = false
  emit('cancel')
}

function choose(action: 'overwrite' | 'skip') {
  if (props.loading) return
  emit('resolve', action)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-backdrop" @click.self="onCancel">
      <div class="drawer" role="alertdialog" aria-modal="true">
        <h3>导入冲突</h3>
        <p class="muted">{{ descriptionText }}</p>
        <ul v-if="conflicts.length" class="list">
          <li v-for="c in conflicts.slice(0, 8)" :key="c.id + c.existingId + c.name">
            「{{ c.name }}」↔ 已有「{{ c.existingName }}」（{{ reasonLabel(c.reason) }}）
          </li>
          <li v-if="conflicts.length > 8" class="muted">…其余 {{ conflicts.length - 8 }} 项</li>
        </ul>
        <div class="actions" style="margin-top: 14px">
          <button class="btn" type="button" :disabled="loading" @click="choose('overwrite')">
            {{ loading ? '处理中…' : '覆盖冲突项' }}
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="choose('skip')">
            跳过冲突项
          </button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="onCancel">
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.list {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 13px;
  max-height: 200px;
  overflow: auto;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
