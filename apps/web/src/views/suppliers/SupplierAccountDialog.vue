<script setup lang="ts">
import { createSupplierAccountSchema, type SupplierAccountDto, type SupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { supplierAccountsApi } from '@/api/suppliers';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

/** 开通门户账号（R04-10）：默认填供应商的联系邮箱和联系人 */
const props = defineProps<{ supplier: SupplierDto }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [SupplierAccountDto] }>();

const { t } = useI18n();
const form = reactive({ email: '', name: '' });
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, { email: props.supplier.contactEmail ?? '', name: props.supplier.contactName });
});

async function save(): Promise<void> {
  errors.value = zodErrors(createSupplierAccountSchema, form);
  if (Object.keys(errors.value).length > 0) return;
  saving.value = true;
  try {
    const body = createSupplierAccountSchema.parse(form);
    const created = await supplierAccountsApi.create(props.supplier.id, body);
    ElMessage.success(t('suppliers.accounts.created', { email: body.email }));
    emit('created', created);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'SUPPLIER_ACCOUNT_EXISTS') errors.value = { email: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('suppliers.accounts.create')"
    width="520px"
    :close-on-click-modal="false"
  >
    <el-alert
      :title="t('suppliers.accounts.createTip')"
      type="info"
      show-icon
      :closable="false"
      class="tip-alert"
    />
    <el-form label-width="auto" @submit.prevent="save">
      <el-form-item :label="t('suppliers.accounts.fields.email')" :error="errors.email" required>
        <el-input v-model="form.email" maxlength="100" autocomplete="off" />
        <div class="tip">{{ t('suppliers.accounts.emailTip') }}</div>
      </el-form-item>
      <el-form-item :label="t('suppliers.accounts.fields.name')" :error="errors.name" required>
        <el-input v-model="form.name" maxlength="50" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">
        {{ t('suppliers.accounts.create') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tip-alert {
  margin-bottom: 16px;
}
.tip {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
