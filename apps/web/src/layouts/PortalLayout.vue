<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppMenu from '@/components/AppMenu.vue';
import LanguageSwitch from '@/components/LanguageSwitch.vue';
import UserMenu from '@/components/UserMenu.vue';
import { portalRoute } from '@/router/routes';

const { t } = useI18n();
</script>

<template>
  <el-container class="layout">
    <el-header class="layout-header">
      <div class="brand">{{ t('common.appName') }}</div>
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
