<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';

const { t } = useI18n();
const note = ref('');
</script>

<template>
  <div>
    <PageHeader :title="t('workbench.title')" />
    <el-card shadow="never" class="qf-card">
      <p>{{ t('workbench.welcome') }}</p>
      <el-input v-model="note" :placeholder="t('workbench.notePlaceholder')" style="max-width: 480px" />
    </el-card>
  </div>
</template>
