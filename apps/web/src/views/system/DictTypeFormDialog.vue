<script setup lang="ts">
import { createDictTypeSchema, updateDictTypeSchema, type DictTypeDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { dictAdminApi } from '@/api/system';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const props = defineProps<{ type: DictTypeDto | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [code: string] }>();

const { t } = useI18n();
const isEdit = computed(() => props.type !== null);
const form = reactive({ code: '', nameZh: '', nameEn: '' });
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, { code: props.type?.code ?? '', nameZh: props.type?.nameZh ?? '', nameEn: props.type?.nameEn ?? '' });
});

async function save(): Promise<void> {
  const data = isEdit.value ? { nameZh: form.nameZh, nameEn: form.nameEn } : { ...form };
  errors.value = zodErrors(isEdit.value ? updateDictTypeSchema : createDictTypeSchema, data);
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    if (isEdit.value) await dictAdminApi.updateType(props.type!.code, updateDictTypeSchema.parse(data));
    else await dictAdminApi.createType(createDictTypeSchema.parse(data));
    ElMessage.success(t('common.saved'));
    emit('saved', isEdit.value ? props.type!.code : form.code.trim());
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'DICT_TYPE_CODE_TAKEN') errors.value = { code: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="isEdit ? t('system.dicts.editType') : t('system.dicts.createType')" width="520px">
    <el-form label-width="auto" @submit.prevent="save">
      <el-form-item :label="t('system.dicts.typeFields.code')" :error="errors.code" required>
        <el-input v-model="form.code" :disabled="isEdit" :placeholder="t('system.dicts.typeCodeRule')" maxlength="50" />
      </el-form-item>
      <el-form-item :label="t('system.dicts.typeFields.nameZh')" :error="errors.nameZh" required>
        <el-input v-model="form.nameZh" maxlength="50" />
      </el-form-item>
      <el-form-item :label="t('system.dicts.typeFields.nameEn')" :error="errors.nameEn" required>
        <el-input v-model="form.nameEn" maxlength="100" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>
