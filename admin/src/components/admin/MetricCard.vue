<template>
  <div class="metric-card" :class="tone">
    <div>
      <div class="metric-label">{{ label }}</div>
      <div class="metric-value">{{ displayValue }}</div>
      <div class="metric-caption" v-if="caption">{{ caption }}</div>
    </div>
    <el-icon class="metric-icon" v-if="icon"><component :is="icon" /></el-icon>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 0 },
  caption: { type: String, default: '' },
  icon: { type: String, default: '' },
  tone: { type: String, default: 'primary' }
})

const animatedValue = ref(Number(props.value) || 0)
const canAnimate = computed(() => typeof props.value === 'number' || /^\d+(\.\d+)?$/.test(String(props.value)))
const displayValue = computed(() => canAnimate.value ? Math.round(animatedValue.value) : props.value)

watch(
  () => props.value,
  (next, old) => {
    if (!canAnimate.value) {
      animatedValue.value = 0
      return
    }
    const from = Number(old) || 0
    const to = Number(next) || 0
    const start = performance.now()
    const duration = 620
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      animatedValue.value = from + (to - from) * eased
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  },
  { immediate: true }
)
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
  position: relative;
  overflow: hidden;
  animation: jy-fade-up var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease) both;
  transition: transform var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease), box-shadow var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease), filter var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease);
}

.metric-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.18) 45%, transparent 70%);
  transform: translateX(-100%);
  transition: transform 720ms var(--jy-motion-ease, ease);
}

.metric-card:hover {
  transform: translateY(-4px) scale(1.01);
  box-shadow: 0 12px 28px rgba(0, 21, 41, 0.16);
  filter: saturate(1.08);
}

.metric-card:hover::after {
  transform: translateX(100%);
}

.metric-card.warning { background: linear-gradient(135deg, var(--jy-accent, #C4943A), #D6A756); }
.metric-card.success { background: linear-gradient(135deg, #2BA471, #45BF8A); }
.metric-card.danger { background: linear-gradient(135deg, #E8684A, #F07A5F); }
.metric-card.info { background: linear-gradient(135deg, #5C7CFA, #7894FF); }
.metric-card.primary { background: linear-gradient(135deg, var(--jy-primary, #0066CC), #2C83E8); }

.metric-label,
.metric-value,
.metric-caption,
.metric-icon {
  position: relative;
  z-index: 1;
}

.metric-label {
  font-size: 14px;
  opacity: 0.9;
}

.metric-value {
  margin-top: 8px;
  font-size: 30px;
  line-height: 1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.metric-caption {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.82;
}

.metric-icon {
  font-size: 32px;
  opacity: 0.82;
  transition: transform var(--jy-motion-normal, 260ms) var(--jy-motion-spring, ease);
}

.metric-card:hover .metric-icon {
  transform: scale(1.12) rotate(-4deg);
}
</style>
