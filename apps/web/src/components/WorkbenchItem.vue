<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

/** 工作台卡片里的一条：单号 + 标题、说明（多段用 · 连接）、右侧标签（tags 插槽） */
const props = defineProps<{
  to: RouteLocationRaw;
  no: string;
  title: string;
  meta?: (string | null | undefined | false)[];
}>();

const metaText = computed(() => (props.meta ?? []).filter(Boolean).join(' · '));
</script>

<template>
  <li class="wb-item">
    <router-link :to="to" class="link">
      <div class="main">
        <div class="line">
          <span class="no">{{ no }}</span>
          <span class="title" :title="title">{{ title }}</span>
        </div>
        <div v-if="metaText" class="meta">{{ metaText }}</div>
      </div>
      <div class="tags"><slot name="tags" /></div>
    </router-link>
  </li>
</template>

<style scoped>
.wb-item + .wb-item {
  border-top: 1px dashed var(--el-border-color-lighter);
}
.link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 4px;
  color: inherit;
  text-decoration: none;
  border-radius: 4px;
}
.link:hover {
  background: var(--el-fill-color-light);
}
.main {
  min-width: 0;
}
.line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
.no {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
}
.title {
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.meta {
  margin-top: 3px;
  overflow: hidden;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tags {
  display: flex;
  flex: none;
  gap: 6px;
}
</style>
