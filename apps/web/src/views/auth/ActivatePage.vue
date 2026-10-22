<script setup lang="ts">
import { isStrongPassword, LOCALES, type Locale } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '@/api/auth';
import { apiError, translateError } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';
import { applyLocale } from '@/i18n';

/**
 * 供应商用激活邮件里的链接设置密码（R04-11）：链接 7 天有效、只能用一次，成功后去登录。
 * 链接带 lang 时按邮件的语言打开（双语邮件不带，按浏览器语言），右上角可以切换。
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const form = reactive({ password: '', confirm: '' });
const errors = ref<{ password?: string; confirm?: string }>({});
const errorMessage = ref('');
const linkInvalid = ref(false);
const done = ref(false);
const submitting = ref(false);

onMounted(() => {
  const lang = route.query.lang;
  if (typeof lang === 'string' && (LOCALES as readonly string[]).includes(lang) && lang !== locale.value) {
    applyLocale(lang as Locale);
  }
});

async function submit(): Promise<void> {
  errors.value = {
    password: isStrongPassword(form.password) ? undefined : t('auth.changePassword.rule'),
    confirm: form.confirm === form.password ? undefined : t('auth.changePassword.mismatch'),
  };
  if (errors.value.password || errors.value.confirm) return;

  submitting.value = true;
  errorMessage.value = '';
  try {
    await authApi.activate(token.value, form.password);
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
  <AuthCard
    :title="t('auth.activate.title')"
    :subtitle="done || !token ? undefined : t('auth.activate.subtitle')"
  >
    <el-alert
      v-if="!token"
      :title="t('auth.activate.missingToken')"
      type="warning"
      show-icon
      :closable="false"
    />
    <template v-else-if="done">
      <el-alert :title="t('auth.activate.success')" type="success" show-icon :closable="false" />
      <el-button type="primary" class="submit to-login" @click="router.push({ name: 'login' })">
        {{ t('auth.activate.toLogin') }}
      </el-button>
    </template>
    <template v-else>
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        :description="linkInvalid ? t('auth.activate.invalidHint') : undefined"
        type="error"
        show-icon
        :closable="false"
        class="alert"
      />
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
          <el-input
            v-model="form.confirm"
            type="password"
            show-password
            autocomplete="new-password"
            name="confirm-password"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="submitting" class="submit">
          {{ t('auth.activate.submit') }}
        </el-button>
      </el-form>
    </template>
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
</style>
