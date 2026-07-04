<template>
  <el-card shadow="never" class="filter-bar">
    <div class="filter-bar-inner">
      <div class="filter-bar-fields">
        <slot />
      </div>
      <div class="filter-bar-actions">
        <el-button type="primary" @click="$emit('search')">查询</el-button>
        <el-button @click="$emit('reset')">重置</el-button>
        <slot name="actions" />
      </div>
    </div>
  </el-card>
</template>

<script setup>
defineEmits(['search', 'reset'])
</script>

<style scoped>
.filter-bar :deep(.el-card__body) {
  padding: 16px;
}

.filter-bar-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.filter-bar-fields {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .filter-bar-inner {
    flex-direction: column;
  }

  .filter-bar-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
