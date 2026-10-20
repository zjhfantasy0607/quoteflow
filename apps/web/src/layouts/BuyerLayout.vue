<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppMenu from '@/components/AppMenu.vue';
import LanguageSwitch from '@/components/LanguageSwitch.vue';
import UserMenu from '@/components/UserMenu.vue';
import { buyerRoute } from '@/router/routes';

const { t } = useI18n();
const collapsed = ref(false);
</script>

<template>
  <el-container class="layout">
    <el-header class="layout-header">
      <div class="brand">{{ t('common.appName') }}</div>
      <div class="spacer" />
      <LanguageSwitch />
      <UserMenu />
    </el-header>
    <el-container class="layout-body">
      <el-aside :width="collapsed ? '64px' : '220px'" class="layout-aside">
        <AppMenu :layout="buyerRoute" :collapsed="collapsed" />
        <div class="collapse-toggle" @click="collapsed = !collapsed">
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span v-if="!collapsed">{{ t('common.actions.collapse') }}</span>
        </div>
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
  gap: 16px;
  height: var(--qf-header-height);
  background: var(--qf-navy);
  color: #fff;
}
.brand {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.spacer {
  flex: 1;
}
.layout-body {
  height: calc(100% - var(--qf-header-height));
}
.layout-aside {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--el-border-color-light);
  transition: width 0.2s;
}
.collapse-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  border-top: 1px solid var(--el-border-color-lighter);
}
.layout-main {
  padding: 20px 24px;
  overflow: auto;
}
</style>
