<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';

const { t } = useI18n();
</script>

<template>
  <div>
    <PageHeader :title="t('nav.portalHome')" />
    <el-card shadow="never">{{ t('workbench.portalWelcome') }}</el-card>
  </div>
</template>
