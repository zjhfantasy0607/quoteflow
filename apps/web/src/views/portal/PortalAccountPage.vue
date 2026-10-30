<script setup lang="ts">
import type { Locale } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { pickName } from '@/utils/format';
import { setPageTitle } from '@/utils/title';

/** 账号设置（M08）：界面语言保存到账号上（下次登录照样生效），修改密码复用 /api/auth/me/password */
const { t, locale } = useI18n();
const auth = useAuthStore();
const route = useRoute();
const showPassword = ref(false);

async function changeLocale(value: string | number | boolean | undefined): Promise<void> {
  await auth.setLocale(value as Locale);
  setPageTitle(route.meta.titleKey);
  ElMessage.success(t('portal.account.languageSaved'));
}
</script>

<template>
  <div>
    <PageHeader :title="t('portal.account.title')" :subtitle="t('portal.account.subtitle')" />
    <el-card v-if="auth.me" shadow="never" class="qf-card">
      <el-descriptions :column="1" border class="account">
        <el-descriptions-item :label="t('portal.account.username')">{{
          auth.me.user.username
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('portal.account.name')">{{ auth.me.user.name }}</el-descriptions-item>
        <el-descriptions-item v-if="auth.me.user.supplier" :label="t('portal.account.company')">
          {{ pickName(auth.me.user.supplier, locale) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.account.language')">
          <el-radio-group :model-value="locale" @change="changeLocale">
            <el-radio value="zh-CN">{{ t('common.language.zhCN') }}</el-radio>
            <el-radio value="en-US">{{ t('common.language.enUS') }}</el-radio>
          </el-radio-group>
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.account.password')">
          <el-button icon="Lock" @click="showPassword = true">{{
            t('portal.account.changePassword')
          }}</el-button>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
    <ChangePasswordDialog v-model="showPassword" />
  </div>
</template>

<style scoped>
.account {
  max-width: 720px;
}
</style>
