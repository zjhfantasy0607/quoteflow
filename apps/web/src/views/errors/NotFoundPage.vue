<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <el-result icon="info" :title="t('common.page.notFound.title')" :sub-title="t('common.page.notFound.desc')">
    <template #extra>
      <el-button type="primary" @click="$router.push('/')">{{ t('common.page.notFound.home') }}</el-button>
    </template>
  </el-result>
</template>
