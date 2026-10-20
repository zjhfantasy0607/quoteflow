<script setup lang="ts">
import { isStrongPassword } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { authApi } from '@/api/auth';
import { apiError, translateError } from '@/api/http';

const visible = defineModel<boolean>({ required: true });
const { t } = useI18n();

const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
const errors = ref<Record<string, string>>({});
const submitting = ref(false);

function reset(): void {
  form.oldPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  errors.value = {};
}

function validate(): boolean {
  const e: Record<string, string> = {};
  if (!form.oldPassword) e.oldPassword = t('common.validation.required');
  if (!isStrongPassword(form.newPassword)) e.newPassword = t('auth.changePassword.rule');
  if (form.confirmPassword !== form.newPassword) e.confirmPassword = t('auth.changePassword.mismatch');
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function submit(): Promise<void> {
  if (!validate()) return;
  submitting.value = true;
  try {
    await authApi.changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
    ElMessage.success(t('auth.changePassword.success'));
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'AUTH_OLD_PASSWORD_WRONG') errors.value = { oldPassword: translateError(body) };
    else ElMessage.error(translateError(body));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('auth.changePassword.title')" width="440px" @closed="reset">
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item :label="t('auth.changePassword.oldPassword')" :error="errors.oldPassword" required>
        <el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item :label="t('auth.changePassword.newPassword')" :error="errors.newPassword" required>
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          autocomplete="new-password"
          :placeholder="t('auth.changePassword.rule')"
        />
      </el-form-item>
      <el-form-item :label="t('auth.changePassword.confirmPassword')" :error="errors.confirmPassword" required>
        <el-input v-model="form.confirmPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>
