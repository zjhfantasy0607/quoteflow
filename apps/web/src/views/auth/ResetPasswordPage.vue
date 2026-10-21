<script setup lang="ts">
import { isStrongPassword } from '@quoteflow/shared';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '@/api/auth';
import { apiError, translateError } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';

/** 用找回密码邮件里的链接设置新密码（R02-11）：令牌 1 小时有效、只能用一次，成功后旧会话全部失效 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const form = reactive({ password: '', confirm: '' });
const errors = ref<{ password?: string; confirm?: string }>({});
const errorMessage = ref('');
const linkInvalid = ref(false);
const done = ref(false);
const submitting = ref(false);

async function submit(): Promise<void> {
  errors.value = {
    password: isStrongPassword(form.password) ? undefined : t('auth.changePassword.rule'),
    confirm: form.confirm === form.password ? undefined : t('auth.changePassword.mismatch'),
  };
  if (errors.value.password || errors.value.confirm) return;

  submitting.value = true;
  errorMessage.value = '';
  try {
    await authApi.resetPassword(token.value, form.password);
    done.value = true;
  } catch (err) {
    const body = apiError(err);
    errorMessage.value = translateError(body);
    linkInvalid.value = body?.code === 'AUTH_TOKEN_INVALID' || body?.code === 'VALIDATION_FAILED';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard :title="t('auth.reset.title')" :subtitle="done || !token ? undefined : t('auth.reset.subtitle')">
    <el-alert v-if="!token" :title="t('auth.reset.missingToken')" type="warning" show-icon :closable="false" />
    <template v-else-if="done">
      <el-alert :title="t('auth.reset.success')" type="success" show-icon :closable="false" />
      <el-button type="primary" class="submit to-login" @click="router.push({ name: 'login' })">
        {{ t('auth.reset.toLogin') }}
      </el-button>
    </template>
    <template v-else>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" class="alert" />
      <el-form label-position="top" size="large" @submit.prevent="submit">
        <el-form-item :label="t('auth.changePassword.newPassword')" :error="errors.password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="new-password"
            name="new-password"
            :placeholder="t('auth.changePassword.rule')"
          />
        </el-form-item>
        <el-form-item :label="t('auth.changePassword.confirmPassword')" :error="errors.confirm">
          <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" name="confirm-password" />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="submitting" class="submit">
          {{ t('auth.reset.submit') }}
        </el-button>
      </el-form>
    </template>
    <div v-if="!done && (!token || linkInvalid)" class="links">
      <router-link :to="{ name: 'forgot-password' }">{{ t('auth.reset.requestAgain') }}</router-link>
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
.to-login {
  margin-top: 16px;
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
