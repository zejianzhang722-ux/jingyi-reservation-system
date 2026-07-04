<template>
  <div class="metric-card" :class="tone">
    <div>
      <div class="metric-label">{{ label }}</div>
      <div class="metric-value">{{ value }}</div>
      <div class="metric-caption" v-if="caption">{{ caption }}</div>
    </div>
    <el-icon class="metric-icon" v-if="icon"><component :is="icon" /></el-icon>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 0 },
  caption: { type: String, default: '' },
  icon: { type: String, default: '' },
  tone: { type: String, default: 'primary' }
})
</script>

<style scoped>
.metric-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 104px;
  padding: 18px 20px;
  color: #fff;
  border-radius: var(--jy-radius-md, 10px);
  background: var(--jy-primary, #0066CC);
  box-shadow: var(--jy-shadow-card, 0 2px 8px rgba(0, 21, 41, 0.06));
}

.metric-card.warning { background: var(--jy-accent, #C4943A); }
.metric-card.success { background: #2BA471; }
.metric-card.danger { background: #E8684A; }
.metric-card.info { background: #5C7CFA; }

.metric-label {
  font-size: 14px;
  opacity: 0.9;
}

.metric-value {
  margin-top: 8px;
  font-size: 30px;
  line-height: 1;
  font-weight: 800;
}

.metric-caption {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.82;
}

.metric-icon {
  font-size: 32px;
  opacity: 0.82;
}
</style>
