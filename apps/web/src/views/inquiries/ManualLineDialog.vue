<script setup lang="ts">
import { createLineSchema, type InquiryLineDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictSelect from '@/components/DictSelect.vue';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

/** 添加手工行（R06-2）：名称、规格、单位、分类、数量必填；分类默认取询价单的材料类别 */
const props = defineProps<{ inquiryId: string; roundNo: number; defaultCategoryId: string | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [InquiryLineDto] }>();

const { t } = useI18n();

/** 后端错误码 → 表单字段 */
const FIELD_OF_ERROR: Record<string, string> = {
  DICT_ITEM_INVALID: 'unitCode',
  CATEGORY_DISABLED: 'categoryId',
};

const empty = () => ({
  materialCode: '',
  nameZh: '',
  nameEn: '',
  spec: '',
  unitCode: null as string | null,
  categoryId: null as string | null,
  quantity: '',
  brand: '',
  drawingRef: '',
  remark: '',
});
const form = reactive(empty());
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, empty(), { categoryId: props.defaultCategoryId });
});

async function save(): Promise<void> {
  const data = {
    ...form,
    source: 'MANUAL',
    unitCode: form.unitCode ?? '',
    categoryId: form.categoryId ?? '',
  };
  errors.value = zodErrors(createLineSchema, data);
  if (Object.keys(errors.value).length > 0) return;
  saving.value = true;
  try {
    const line = await inquiriesApi.addLine(props.inquiryId, props.roundNo, createLineSchema.parse(data));
    emit('saved', line);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    const field = body?.code ? FIELD_OF_ERROR[body.code] : undefined;
    if (field) errors.value = { [field]: translateError(body) };
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
    :title="t('inquiries.lines.manualTitle')"
    width="640px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form label-width="auto" @submit.prevent="save">
      <el-form-item :label="t('inquiries.lines.fields.materialCode')" :error="errors.materialCode">
        <el-input
          v-model="form.materialCode"
          maxlength="50"
          :placeholder="t('inquiries.lines.materialCodePlaceholder')"
          @blur="form.materialCode = form.materialCode.trim().toUpperCase()"
        />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.nameZh')" :error="errors.nameZh" required>
        <el-input v-model="form.nameZh" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.nameEn')" :error="errors.nameEn">
        <el-input v-model="form.nameEn" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.spec')" :error="errors.spec" required>
        <el-input v-model="form.spec" maxlength="200" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.unit')" :error="errors.unitCode" required>
        <DictSelect v-model="form.unitCode" type="unit" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.category')" :error="errors.categoryId" required>
        <CategoryTreeSelect v-model="form.categoryId" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.quantity')" :error="errors.quantity" required>
        <el-input v-model="form.quantity" maxlength="20" :placeholder="t('inquiries.lines.quantityHint')" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.brand')" :error="errors.brand">
        <el-input v-model="form.brand" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.drawingRef')" :error="errors.drawingRef">
        <el-input v-model="form.drawingRef" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('inquiries.lines.fields.remark')" :error="errors.remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="1000" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>
