<template>
  <section class="page-shell">
    <div class="page-shell-header" v-if="title || description || $slots.actions">
      <div class="page-shell-copy">
        <div class="page-shell-eyebrow" v-if="eyebrow">{{ eyebrow }}</div>
        <h1 v-if="title">{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="page-shell-actions" v-if="$slots.actions">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  eyebrow: { type: String, default: '' }
})
</script>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-shell-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  padding: 20px 22px;
  background: #FFFFFF;
  border: 1px solid var(--jy-border-light, #F0F0F5);
  border-radius: var(--jy-radius-md, 10px);
  box-shadow: var(--jy-shadow-card, 0 2px 8px rgba(0, 21, 41, 0.06));
}

.page-shell-copy {
  min-width: 0;
}

.page-shell-eyebrow {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 800;
  color: var(--jy-accent, #C4943A);
  letter-spacing: 0.08em;
}

.page-shell h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
  color: var(--jy-text-primary, #1A1A2E);
}

.page-shell p {
  margin: 8px 0 0;
  color: var(--jy-text-secondary, #8C8C9A);
  font-size: 14px;
}

.page-shell-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 768px) {
  .page-shell-header {
    flex-direction: column;
  }

  .page-shell-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
