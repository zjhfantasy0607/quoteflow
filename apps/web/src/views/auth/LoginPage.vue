<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';
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
  <AuthCard :title="t('common.appName')" :subtitle="t('auth.login.subtitle')">
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
      <div class="forgot">
        <router-link :to="{ name: 'forgot-password' }">{{ t('auth.login.forgot') }}</router-link>
      </div>
      <el-button type="primary" native-type="submit" :loading="submitting" class="submit">
        {{ t('auth.login.submit') }}
      </el-button>
    </el-form>
    <p class="hint">{{ t('auth.login.supplierHint') }}</p>
  </AuthCard>
</template>

<style scoped>
.alert {
  margin-bottom: 16px;
}
.forgot {
  margin: -8px 0 8px;
  font-size: 13px;
  text-align: right;
}
.forgot a {
  color: var(--el-color-primary);
  text-decoration: none;
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
