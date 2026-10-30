<script setup lang="ts">
import type { AppConfigDto } from '@quoteflow/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { paramsApi } from '@/api/system';
import AppMenu from '@/components/AppMenu.vue';
import LanguageSwitch from '@/components/LanguageSwitch.vue';
import UserMenu from '@/components/UserMenu.vue';
import { portalRoute } from '@/router/routes';

/** 供应商门户（M08 §5）：顶栏是采购方的公司名称（系统参数 company.profile）+"供应商门户" */
const { t, locale } = useI18n();
const company = ref<AppConfigDto['company'] | null>(null);
const brand = computed(() => {
  if (!company.value) return t('common.appName');
  return locale.value === 'en-US' ? company.value.nameEn : company.value.nameZh;
});

onMounted(async () => {
  company.value = (await paramsApi.appConfig().catch(() => null))?.company ?? null;
});
</script>

<template>
  <el-container class="layout">
    <el-header class="layout-header">
      <div class="brand">{{ brand }}</div>
      <el-divider direction="vertical" />
      <div class="portal-name">{{ t('common.portalName') }}</div>
      <div class="spacer" />
      <LanguageSwitch />
      <UserMenu />
    </el-header>
    <el-container class="layout-body">
      <el-aside width="200px" class="layout-aside">
        <AppMenu :layout="portalRoute" :collapsed="false" />
      </el-aside>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}
.layout-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--qf-header-height);
  background: var(--qf-navy);
  color: #fff;
}
.brand {
  font-size: 18px;
  font-weight: 600;
}
.portal-name {
  font-size: 14px;
  opacity: 0.85;
}
.spacer {
  flex: 1;
}
.layout-body {
  height: calc(100% - var(--qf-header-height));
}
.layout-aside {
  background: #fff;
  border-right: 1px solid var(--el-border-color-light);
}
.layout-main {
  padding: 20px 24px;
  overflow: auto;
}
</style>
