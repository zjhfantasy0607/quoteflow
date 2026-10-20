<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="page-header">
    <div class="titles">
      <h2 class="title">{{ title }}</h2>
      <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    </div>
    <div class="actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}
.title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.actions {
  display: flex;
  gap: 8px;
}
</style>
