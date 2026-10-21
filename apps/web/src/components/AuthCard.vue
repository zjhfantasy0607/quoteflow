<script setup lang="ts">
import LanguageSwitch from './LanguageSwitch.vue';

/** 登录、找回密码、重置密码共用的页面外框 */
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="auth-page">
    <div class="topbar"><LanguageSwitch /></div>
    <el-card class="auth-card" shadow="always">
      <h1 class="title">{{ title }}</h1>
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      <slot />
    </el-card>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  background: linear-gradient(160deg, var(--qf-navy) 0%, #12355e 55%, #0f766e 100%);
}
.topbar {
  position: absolute;
  top: 16px;
  right: 24px;
}
.auth-card {
  width: 400px;
  padding: 8px 12px;
}
.title {
  margin: 0 0 4px;
  font-size: 22px;
  text-align: center;
}
.subtitle {
  margin: 0 0 20px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: center;
}
</style>
