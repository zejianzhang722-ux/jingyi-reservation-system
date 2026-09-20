<!-- src/components/admin/ListToolbar.vue -->
<template>
  <FilterBar @search="emit('search')" @reset="emit('reset')">
    <el-select
      v-if="statusOptions && statusOptions.length"
      v-model="status"
      :placeholder="statusPlaceholder"
      clearable
      style="width: 140px"
      @change="emit('search')"
    >
      <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
    </el-select>

    <el-input
      v-if="keywordPlaceholder"
      v-model="keyword"
      :placeholder="keywordPlaceholder"
      clearable
      style="width: 200px"
      @keyup.enter="emit('search')"
    />

    <slot />

    <template #actions>
      <slot name="actions" />
      <el-button v-if="exportFileName" type="success" @click="emit('export')">
        <el-icon><Download /></el-icon>导出 Excel
      </el-button>
    </template>
  </FilterBar>
</template>

<script setup>
import { watch, onBeforeUnmount } from 'vue'
import FilterBar from './FilterBar.vue'

const status = defineModel('status')
const keyword = defineModel('keyword')
const props = defineProps({
  statusOptions: { type: Array, default: undefined },
  statusPlaceholder: { type: String, default: '状态' },
  keywordPlaceholder: { type: String, default: '' },
  exportFileName: { type: String, default: '' }
})
const emit = defineEmits(['search', 'reset', 'export'])

let timer
watch(keyword, () => {
  clearTimeout(timer)
  timer = setTimeout(() => emit('search'), 300) // 关键词输入防抖后触发查询
})
onBeforeUnmount(() => clearTimeout(timer))
</script>
