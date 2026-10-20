<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <el-result icon="warning" :title="t('common.page.forbidden.title')" :sub-title="t('common.page.forbidden.desc')">
    <template #extra>
      <el-button type="primary" @click="$router.push('/')">{{ t('common.page.forbidden.home') }}</el-button>
    </template>
  </el-result>
</template>
