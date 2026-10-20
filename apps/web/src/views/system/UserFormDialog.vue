<script setup lang="ts">
import {
  createUserSchema,
  isStrongPassword,
  updateUserSchema,
  type Locale,
  type RoleDto,
  type UserDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { usersApi } from '@/api/system';
import DictSelect from '@/components/DictSelect.vue';
import { pickName } from '@/utils/format';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const props = defineProps<{ user: UserDto | null; roles: RoleDto[] }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [UserDto] }>();

const { t, locale } = useI18n();
const isEdit = computed(() => props.user !== null);
const internalRoles = computed(() => props.roles.filter((r) => !r.forSupplier));

const empty = () => ({
  username: '',
  name: '',
  email: '',
  phone: '',
  departmentCode: '' as string | null,
  roleIds: [] as string[],
  locale: 'zh-CN' as Locale,
  password: '',
  remark: '',
});
const form = reactive(empty());
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, empty());
  if (props.user) {
    Object.assign(form, {
      username: props.user.username,
      name: props.user.name,
      email: props.user.email ?? '',
      phone: props.user.phone ?? '',
      departmentCode: props.user.departmentCode,
      roleIds: props.user.roles.map((r) => r.id),
      locale: props.user.locale,
      remark: props.user.remark ?? '',
    });
  }
});

function payload() {
  return {
    name: form.name,
    email: form.email,
    phone: form.phone,
    departmentCode: form.departmentCode ?? '',
    roleIds: form.roleIds,
    locale: form.locale,
    remark: form.remark,
  };
}

async function save(): Promise<void> {
  const data = isEdit.value ? payload() : { ...payload(), username: form.username, password: form.password };
  errors.value = zodErrors(isEdit.value ? updateUserSchema : createUserSchema, data);
  if (!isEdit.value && !errors.value.password && !isStrongPassword(form.password)) {
    errors.value.password = t('system.users.passwordRule');
  }
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = isEdit.value
      ? await usersApi.update(props.user!.id, updateUserSchema.parse(data))
      : await usersApi.create(createUserSchema.parse(data));
    ElMessage.success(t('common.saved'));
    emit('saved', saved);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'USER_USERNAME_TAKEN') errors.value = { username: translateError(body) };
    else if (body?.code === 'USER_EMAIL_TAKEN') errors.value = { email: translateError(body) };
    else if (body?.code === 'AUTH_PASSWORD_WEAK') errors.value = { password: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="isEdit ? t('system.users.edit') : t('system.users.create')" width="560px">
    <el-form label-width="110px" @submit.prevent="save">
      <el-form-item :label="t('system.users.fields.username')" :error="errors.username" required>
        <el-input v-model="form.username" :disabled="isEdit" :placeholder="t('system.users.usernameRule')" />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.name')" :error="errors.name" required>
        <el-input v-model="form.name" maxlength="50" />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.email')" :error="errors.email">
        <el-input v-model="form.email" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.phone')" :error="errors.phone">
        <el-input v-model="form.phone" maxlength="30" />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.department')" :error="errors.departmentCode">
        <DictSelect v-model="form.departmentCode" type="department" />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.roles')" :error="errors.roleIds" required>
        <el-select v-model="form.roleIds" multiple style="width: 100%">
          <el-option v-for="r in internalRoles" :key="r.id" :value="r.id" :label="pickName(r, locale)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('system.users.fields.locale')">
        <el-radio-group v-model="form.locale">
          <el-radio value="zh-CN">{{ t('common.language.zhCN') }}</el-radio>
          <el-radio value="en-US">{{ t('common.language.enUS') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="!isEdit" :label="t('system.users.fields.password')" :error="errors.password" required>
        <el-input
          v-model="form.password"
          type="password"
          show-password
          autocomplete="new-password"
          :placeholder="t('system.users.passwordRule')"
        />
      </el-form-item>
      <el-form-item :label="t('system.users.fields.remark')" :error="errors.remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>
