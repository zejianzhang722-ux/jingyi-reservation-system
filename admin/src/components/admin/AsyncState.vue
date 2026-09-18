<template>
  <div v-if="loading" class="async-state async-state--loading" role="status" aria-live="polite">
    <el-skeleton :rows="3" animated />
    <span class="sr-only">正在加载</span>
  </div>
  <el-result v-else-if="error" role="alert" aria-live="assertive" icon="error" :title="errorTitle" :sub-title="errorMessage">
    <template #extra>
      <el-button type="primary" @click="$emit('retry')">重新加载</el-button>
    </template>
  </el-result>
  <div v-else-if="empty" class="async-state async-state--empty" aria-live="polite">
    <el-empty :description="emptyDescription">
      <slot name="empty-action" />
    </el-empty>
  </div>
  <slot v-else />
</template>

<script setup>
/**
 * 列表/图表通用三态容器（加载 / 错误 / 空态）。
 *
 * Batch4 · R-11 一致性：全站列表页统一复用本组件，替代各页面内联的
 * `el-empty` + `loadError` 手判逻辑，保证「没数据」与「坏了」两种状态视觉可分。
 *
 * 向后兼容：新增的 `errorTitle` / `emptyDescription` 均有缺省值，`empty-action` 具名插槽可选；
 * 既有调用点（如 Stats/Overview.vue）无需改动。
 */
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  errorTitle: { type: String, default: '加载失败' },
  errorMessage: { type: String, default: '加载失败，请稍后重试' },
  emptyDescription: { type: String, default: '暂无数据' }
})

defineEmits(['retry'])
</script>

<style scoped>
.async-state {
  padding: 24px;
}

.async-state--empty {
  padding: 8px 24px;
}
</style>
