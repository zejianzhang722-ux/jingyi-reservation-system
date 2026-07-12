<template>
  <div v-if="loading" class="async-state async-state--loading" role="status" aria-live="polite">
    <el-skeleton :rows="3" animated />
    <span class="sr-only">正在加载</span>
  </div>
  <el-result v-else-if="error" role="alert" aria-live="assertive" icon="error" title="加载失败" :sub-title="errorMessage">
    <template #extra>
      <el-button type="primary" @click="$emit('retry')">重新加载</el-button>
    </template>
  </el-result>
  <el-empty v-else-if="empty" aria-live="polite" description="暂无数据" />
  <slot v-else />
</template>

<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  errorMessage: { type: String, default: '加载失败，请稍后重试' }
})

defineEmits(['retry'])
</script>

<style scoped>
.async-state {
  padding: 24px;
}
</style>
