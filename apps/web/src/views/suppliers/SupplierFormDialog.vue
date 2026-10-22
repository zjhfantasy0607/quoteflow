<script setup lang="ts">
import {
  createSupplierSchema,
  MAX_CC_EMAILS,
  SUPPLIER_LANGUAGES,
  updateSupplierSchema,
  type SupplierDto,
  type SupplierLanguage,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { suppliersApi } from '@/api/suppliers';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import SupplierCategorySelect from '@/components/SupplierCategorySelect.vue';
import { supplierLanguageLabel } from '@/utils/suppliers';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const props = defineProps<{ supplier: SupplierDto | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [SupplierDto] }>();

const { t } = useI18n();
const isEdit = computed(() => props.supplier !== null);

/** 后端错误码 → 表单字段 */
const FIELD_OF_ERROR: Record<string, string> = {
  SUPPLIER_CODE_TAKEN: 'code',
  SUPPLIER_CREDIT_CODE_TAKEN: 'creditCode',
  DICT_ITEM_INVALID: 'categoryCode',
  CATEGORY_DISABLED: 'materialCategoryIds',
};

/** 抄送邮箱可以用逗号、分号或空格分隔一次粘贴多个 */
const CC_DELIMITER = /[,;\s]/;

const empty = () => ({
  code: '',
  nameZh: '',
  nameEn: '',
  creditCode: '',
  categoryCode: '' as string | null,
  materialCategoryIds: [] as string[],
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  ccEmails: [] as string[] | undefined,
  preferredLanguage: 'zh-CN' as SupplierLanguage,
  country: '',
  address: '',
  remark: '',
});
const form = reactive(empty());
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, empty());
  const s = props.supplier;
  if (s) {
    Object.assign(form, {
      code: s.code,
      nameZh: s.nameZh,
      nameEn: s.nameEn ?? '',
      creditCode: s.creditCode ?? '',
      categoryCode: s.categoryCode,
      materialCategoryIds: s.materialCategories.map((c) => c.id),
      contactName: s.contactName,
      contactEmail: s.contactEmail ?? '',
      contactPhone: s.contactPhone ?? '',
      ccEmails: [...(s.ccEmails ?? [])],
      preferredLanguage: s.preferredLanguage,
      country: s.country ?? '',
      address: s.address ?? '',
      remark: s.remark ?? '',
    });
  }
});

function payload() {
  return {
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    creditCode: form.creditCode,
    categoryCode: form.categoryCode ?? '',
    materialCategoryIds: form.materialCategoryIds,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    ccEmails: form.ccEmails ?? [],
    preferredLanguage: form.preferredLanguage,
    country: form.country,
    address: form.address,
    remark: form.remark,
  };
}

/** 数组字段的错误（如 ccEmails.2）显示在字段本身上 */
function byField(fieldErrors: FieldErrors): FieldErrors {
  const result: FieldErrors = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = path.split('.')[0];
    result[field] ??= message;
  }
  return result;
}

async function save(): Promise<void> {
  const data = isEdit.value ? payload() : { ...payload(), code: form.code };
  errors.value = byField(zodErrors(isEdit.value ? updateSupplierSchema : createSupplierSchema, data));
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = isEdit.value
      ? await suppliersApi.update(props.supplier!.id, updateSupplierSchema.parse(data))
      : await suppliersApi.create(createSupplierSchema.parse(data));
    ElMessage.success(t('common.saved'));
    emit('saved', saved);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    const field = body?.code ? FIELD_OF_ERROR[body.code] : undefined;
    if (field) errors.value = { [field]: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = byField(serverFieldErrors(body.details));
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('suppliers.list.edit') : t('suppliers.list.create')"
    width="760px"
    :close-on-click-modal="false"
  >
    <el-form label-width="auto" @submit.prevent="save">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.code')" :error="errors.code">
            <el-input
              v-model="form.code"
              :disabled="isEdit"
              maxlength="30"
              :placeholder="t('suppliers.list.codePlaceholder')"
              @blur="form.code = form.code.trim().toUpperCase()"
            />
            <div v-if="!isEdit" class="tip">{{ t('suppliers.list.codeRule') }}</div>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.category')" :error="errors.categoryCode" required>
            <SupplierCategorySelect v-model="form.categoryCode" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="t('suppliers.list.fields.nameZh')" :error="errors.nameZh" required>
        <el-input v-model="form.nameZh" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('suppliers.list.fields.nameEn')" :error="errors.nameEn">
        <el-input v-model="form.nameEn" maxlength="200" />
      </el-form-item>
      <el-form-item :label="t('suppliers.list.fields.creditCode')" :error="errors.creditCode">
        <el-input
          v-model="form.creditCode"
          maxlength="18"
          :placeholder="t('suppliers.list.creditCodePlaceholder')"
          @blur="form.creditCode = form.creditCode.trim().toUpperCase()"
        />
      </el-form-item>
      <el-form-item
        :label="t('suppliers.list.fields.materialCategories')"
        :error="errors.materialCategoryIds"
      >
        <CategoryTreeSelect
          v-model="form.materialCategoryIds"
          multiple
          :placeholder="t('suppliers.list.materialCategoriesPlaceholder')"
        />
      </el-form-item>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.contactName')" :error="errors.contactName" required>
            <el-input v-model="form.contactName" maxlength="50" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.contactPhone')" :error="errors.contactPhone">
            <el-input v-model="form.contactPhone" maxlength="30" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="t('suppliers.list.fields.contactEmail')" :error="errors.contactEmail" required>
        <el-input v-model="form.contactEmail" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('suppliers.list.fields.ccEmails')" :error="errors.ccEmails">
        <el-input-tag
          v-model="form.ccEmails"
          :max="MAX_CC_EMAILS"
          :delimiter="CC_DELIMITER"
          clearable
          :placeholder="t('suppliers.list.ccEmailsPlaceholder')"
        />
        <div class="tip">{{ t('suppliers.list.ccEmailsTip') }}</div>
      </el-form-item>
      <el-form-item :label="t('suppliers.list.fields.language')" :error="errors.preferredLanguage">
        <el-radio-group v-model="form.preferredLanguage">
          <el-radio v-for="lang in SUPPLIER_LANGUAGES" :key="lang" :value="lang">
            {{ supplierLanguageLabel(lang) }}
          </el-radio>
        </el-radio-group>
        <div class="tip">{{ t('suppliers.list.languageTip') }}</div>
      </el-form-item>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.country')" :error="errors.country">
            <el-input v-model="form.country" maxlength="50" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="t('suppliers.list.fields.address')" :error="errors.address">
            <el-input v-model="form.address" maxlength="200" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="t('suppliers.list.fields.remark')" :error="errors.remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="1000" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tip {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
