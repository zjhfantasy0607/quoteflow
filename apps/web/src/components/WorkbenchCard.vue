<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

/** 工作台的一张卡片（M16）：标题、数量、前几条（默认插槽放 WorkbenchItem）、"查看全部" */
const props = defineProps<{
  title: string;
  total: number;
  /** 标题下的说明 */
  hint?: string;
  /** "查看全部"的去处；当前用户进不去这个页面时不显示 */
  viewAll?: RouteLocationRaw;
}>();

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();

const viewAllVisible = computed(() => {
  if (!props.viewAll) return false;
  const perm = router.resolve(props.viewAll).meta.perm as string | string[] | undefined;
  return auth.hasPerm(perm);
});
</script>

<template>
  <section class="wb-card">
    <header class="head">
      <div class="titles">
        <h3 class="title">{{ title }}</h3>
        <span v-if="hint" class="hint">{{ hint }}</span>
      </div>
      <span class="count" :class="{ active: total > 0 }">{{ total }}</span>
    </header>
    <div v-if="total === 0" class="empty">{{ t('workbench.empty') }}</div>
    <ul v-else class="items">
      <slot />
    </ul>
    <footer v-if="viewAllVisible && total > 0" class="foot">
      <router-link :to="viewAll!" class="view-all">{{ t('workbench.viewAll') }} ›</router-link>
    </footer>
  </section>
</template>

<style scoped>
.wb-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.titles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.count {
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  color: var(--el-text-color-placeholder);
}
.count.active {
  color: var(--el-color-primary);
}
.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
}
.foot {
  margin-top: auto;
  padding-top: 8px;
  text-align: right;
}
.view-all {
  font-size: 13px;
  color: var(--el-color-primary);
  text-decoration: none;
}
.view-all:hover {
  text-decoration: underline;
}
</style>
