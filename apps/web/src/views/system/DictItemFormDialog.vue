<script setup lang="ts">
import { createDictItemSchema, updateDictItemSchema, type DictItemDto, type EnableStatus } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { dictAdminApi } from '@/api/system';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const props = defineProps<{ typeCode: string; item: DictItemDto | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [DictItemDto] }>();

const { t } = useI18n();
const isEdit = computed(() => props.item !== null);
const empty = () => ({ code: '', nameZh: '', nameEn: '', sort: 0, remark: '', status: 'ENABLED' as EnableStatus });
const form = reactive(empty());
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  errors.value = {};
  Object.assign(form, empty());
  if (props.item) {
    const { code, nameZh, nameEn, sort, remark, status } = props.item;
    Object.assign(form, { code, nameZh, nameEn, sort, remark: remark ?? '', status });
  }
});

async function save(): Promise<void> {
  const base = { nameZh: form.nameZh, nameEn: form.nameEn, sort: form.sort, remark: form.remark };
  const data = isEdit.value ? { ...base, status: form.status } : { ...base, code: form.code };
  errors.value = zodErrors(isEdit.value ? updateDictItemSchema : createDictItemSchema, data);
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = isEdit.value
      ? await dictAdminApi.updateItem(props.item!.id, updateDictItemSchema.parse(data))
      : await dictAdminApi.createItem(props.typeCode, createDictItemSchema.parse(data));
    ElMessage.success(t('common.saved'));
    emit('saved', saved);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'DICT_ITEM_CODE_TAKEN') errors.value = { code: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="isEdit ? t('system.dicts.editItem') : t('system.dicts.createItem')" width="520px">
    <el-form label-width="auto" @submit.prevent="save">
      <el-form-item :label="t('system.dicts.itemFields.code')" :error="errors.code" required>
        <el-input v-model="form.code" :disabled="isEdit" :placeholder="t('system.dicts.itemCodeRule')" maxlength="50" />
      </el-form-item>
      <el-form-item :label="t('system.dicts.itemFields.nameZh')" :error="errors.nameZh" required>
        <el-input v-model="form.nameZh" maxlength="100" />
      </el-form-item>
      <el-form-item :label="t('system.dicts.itemFields.nameEn')" :error="errors.nameEn" required>
        <el-input v-model="form.nameEn" maxlength="200" />
      </el-form-item>
      <el-form-item :label="t('system.dicts.itemFields.sort')" :error="errors.sort">
        <el-input-number v-model="form.sort" :min="0" :max="9999" :precision="0" controls-position="right" />
      </el-form-item>
      <el-form-item v-if="isEdit" :label="t('system.dicts.itemFields.status')">
        <el-radio-group v-model="form.status">
          <el-radio value="ENABLED">{{ t('enums.EnableStatus.ENABLED') }}</el-radio>
          <el-radio value="DISABLED">{{ t('enums.EnableStatus.DISABLED') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('system.dicts.itemFields.remark')" :error="errors.remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>
