<script setup lang="ts">
import { createMaterialSchema, updateMaterialSchema, type FileDto, type MaterialDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { materialsApi } from '@/api/materials';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictSelect from '@/components/DictSelect.vue';
import FileUploader from '@/components/FileUploader.vue';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const props = defineProps<{ material: MaterialDto | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [MaterialDto] }>();

const { t } = useI18n();
const isEdit = computed(() => props.material !== null);

/** 后端错误码 → 表单字段 */
const FIELD_OF_ERROR: Record<string, string> = {
  MATERIAL_CODE_TAKEN: 'code',
  DICT_ITEM_INVALID: 'unitCode',
  CATEGORY_DISABLED: 'categoryId',
  FILE_TYPE_NOT_ALLOWED: 'imageFileId',
  FILE_ACCESS_DENIED: 'imageFileId',
};

const empty = () => ({
  code: '',
  nameZh: '',
  nameEn: '',
  spec: '',
  unitCode: '' as string | null,
  categoryId: '' as string | null,
  brand: '',
  remark: '',
  images: [] as FileDto[],
});
const form = reactive(empty());
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, empty());
  const m = props.material;
  if (m) {
    Object.assign(form, {
      code: m.code,
      nameZh: m.nameZh,
      nameEn: m.nameEn ?? '',
      spec: m.spec,
      unitCode: m.unitCode,
      categoryId: m.category.id,
      brand: m.brand ?? '',
      remark: m.remark ?? '',
      images: m.image ? [m.image] : [],
    });
  }
});

function payload() {
  return {
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    spec: form.spec,
    unitCode: form.unitCode ?? '',
    categoryId: form.categoryId ?? '',
    brand: form.brand,
    remark: form.remark,
    imageFileId: form.images[0]?.id ?? null,
  };
}

async function save(): Promise<void> {
  const data = isEdit.value ? payload() : { ...payload(), code: form.code };
  errors.value = zodErrors(isEdit.value ? updateMaterialSchema : createMaterialSchema, data);
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = isEdit.value
      ? await materialsApi.update(props.material!.id, updateMaterialSchema.parse(data))
      : await materialsApi.create(createMaterialSchema.parse(data));
    ElMessage.success(t('common.saved'));
    emit('saved', saved);
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
    :title="isEdit ? t('materials.list.edit') : t('materials.list.create')"
    width="640px"
    :close-on-click-modal="false"
  >
    <el-form label-width="auto" @submit.prevent="save">
      <el-form-item :label="t('materials.list.fields.code')" :error="errors.code">
        <el-input
          v-model="form.code"
          :disabled="isEdit"
          maxlength="50"
          :placeholder="t('materials.list.codePlaceholder')"
          @blur="form.code = form.code.trim().toUpperCase()"
        />
        <div v-if="!isEdit" class="tip">{{ t('materials.list.codeRule') }}</div>
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.nameZh')" :error="errors.nameZh" required>
        <el-input v-model="form.nameZh" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.nameEn')" :error="errors.nameEn">
        <el-input v-model="form.nameEn" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.spec')" :error="errors.spec" required>
        <el-input v-model="form.spec" maxlength="200" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.unit')" :error="errors.unitCode" required>
        <DictSelect v-model="form.unitCode" type="unit" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.category')" :error="errors.categoryId" required>
        <CategoryTreeSelect v-model="form.categoryId" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.brand')" :error="errors.brand">
        <el-input v-model="form.brand" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.remark')" :error="errors.remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="1000" />
      </el-form-item>
      <el-form-item :label="t('materials.list.fields.image')" :error="errors.imageFileId">
        <FileUploader v-model="form.images" kind="MATERIAL_IMAGE" :limit="1" />
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
