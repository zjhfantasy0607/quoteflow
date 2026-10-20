<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import LanguageSwitch from '@/components/LanguageSwitch.vue';
import { useAuthStore } from '@/stores/auth';

const { t } = useI18n();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const form = reactive({ username: '', password: '' });
const errors = ref<{ username?: string; password?: string }>({});
const errorMessage = ref('');
const submitting = ref(false);

async function submit(): Promise<void> {
  errors.value = {
    username: form.username.trim() ? undefined : t('common.validation.required'),
    password: form.password ? undefined : t('common.validation.required'),
  };
  if (errors.value.username || errors.value.password) return;

  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.login(form.username.trim(), form.password);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
    await router.replace(redirect.startsWith('/') ? redirect : auth.homePath);
  } catch (err) {
    errorMessage.value = translateError(apiError(err));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="topbar"><LanguageSwitch /></div>
    <el-card class="login-card" shadow="always">
      <h1 class="title">{{ t('common.appName') }}</h1>
      <p class="subtitle">{{ t('auth.login.subtitle') }}</p>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" class="alert" />
      <el-form label-position="top" size="large" @submit.prevent="submit">
        <el-form-item :label="t('auth.login.username')" :error="errors.username">
          <el-input v-model="form.username" prefix-icon="User" autocomplete="username" name="username" />
        </el-form-item>
        <el-form-item :label="t('auth.login.password')" :error="errors.password">
          <el-input
            v-model="form.password"
            type="password"
            prefix-icon="Lock"
            show-password
            autocomplete="current-password"
            name="password"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="submitting" class="submit">
          {{ t('auth.login.submit') }}
        </el-button>
      </el-form>
      <p class="hint">{{ t('auth.login.supplierHint') }}</p>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
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
.login-card {
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
.alert {
  margin-bottom: 16px;
}
.submit {
  width: 100%;
  margin-top: 8px;
}
.hint {
  margin: 16px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: center;
}
</style>
