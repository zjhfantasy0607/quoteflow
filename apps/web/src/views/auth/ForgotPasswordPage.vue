<script setup lang="ts">
import { forgotPasswordSchema } from '@quoteflow/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { authApi } from '@/api/auth';
import { apiError, translateError } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';
import { zodErrors } from '@/utils/validate';

/** 找回密码（R02-11）：无论邮箱是否登记都显示同样的结果，不泄露账号是否存在 */
const { t } = useI18n();
const email = ref('');
const fieldError = ref('');
const errorMessage = ref('');
const sent = ref(false);
const submitting = ref(false);

async function submit(): Promise<void> {
  fieldError.value = zodErrors(forgotPasswordSchema, { email: email.value }).email ?? '';
  if (fieldError.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await authApi.forgotPassword(email.value.trim());
    sent.value = true;
  } catch (err) {
    errorMessage.value = translateError(apiError(err));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard :title="t('auth.forgot.title')" :subtitle="sent ? undefined : t('auth.forgot.subtitle')">
    <el-alert v-if="sent" :title="t('auth.forgot.sent')" type="success" show-icon :closable="false" />
    <template v-else>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" class="alert" />
      <el-form label-position="top" size="large" @submit.prevent="submit">
        <el-form-item :label="t('auth.forgot.email')" :error="fieldError">
          <el-input v-model="email" prefix-icon="Message" autocomplete="email" name="email" />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="submitting" class="submit">
          {{ t('auth.forgot.submit') }}
        </el-button>
      </el-form>
    </template>
    <div class="links">
      <router-link :to="{ name: 'login' }">{{ t('auth.forgot.backToLogin') }}</router-link>
    </div>
  </AuthCard>
</template>

<style scoped>
.alert {
  margin-bottom: 16px;
}
.submit {
  width: 100%;
}
.links {
  margin-top: 16px;
  font-size: 13px;
  text-align: center;
}
.links a {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
