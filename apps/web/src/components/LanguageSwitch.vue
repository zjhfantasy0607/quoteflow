<script setup lang="ts">
import type { Locale } from '@quoteflow/shared';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { setPageTitle } from '@/utils/title';

const { t, locale } = useI18n();
const auth = useAuthStore();
const route = useRoute();

async function change(value: string | number | boolean | undefined): Promise<void> {
  await auth.setLocale(value as Locale);
  setPageTitle(route.meta.titleKey);
}
</script>

<template>
  <el-radio-group :model-value="locale" size="small" class="language-switch" @change="change">
    <el-radio-button value="zh-CN">{{ t('common.language.zhCN') }}</el-radio-button>
    <el-radio-button value="en-US">{{ t('common.language.enUS') }}</el-radio-button>
  </el-radio-group>
</template>
