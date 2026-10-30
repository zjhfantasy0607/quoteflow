<script setup lang="ts">
import type { PortalQuoteDetailDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import DictSelect from '@/components/DictSelect.vue';

/** 拒绝报价（R09-6）：原因（字典 decline_reason）和说明都必填；已提交过的提示拒绝后已提交的报价不再有效 */
const props = defineProps<{ quoteId: string; submitted: boolean }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ declined: [PortalQuoteDetailDto] }>();

const { t } = useI18n();
const form = reactive({ reasonCode: '', reason: '' });
const errors = reactive({ reasonCode: '', reason: '' });
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  Object.assign(form, { reasonCode: '', reason: '' });
  Object.assign(errors, { reasonCode: '', reason: '' });
});

async function confirm(): Promise<void> {
  errors.reasonCode = form.reasonCode ? '' : t('common.validation.required');
  errors.reason = form.reason.trim() ? '' : t('common.validation.required');
  if (errors.reasonCode || errors.reason) return;
  saving.value = true;
  try {
    const detail = await portalApi.decline(props.quoteId, {
      reasonCode: form.reasonCode,
      reason: form.reason.trim(),
    });
    ElMessage.success(t('portal.decline.done'));
    emit('declined', detail);
    visible.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('portal.decline.title')" width="520px" append-to-body>
    <el-alert
      :type="submitted ? 'warning' : 'info'"
      :title="submitted ? t('portal.decline.submittedHint') : t('portal.decline.hint')"
      show-icon
      :closable="false"
      class="hint"
    />
    <el-form label-position="top">
      <el-form-item :label="t('portal.decline.reasonCode')" required :error="errors.reasonCode">
        <DictSelect v-model="form.reasonCode" type="decline_reason" :clearable="false" />
      </el-form-item>
      <el-form-item :label="t('portal.decline.reason')" required :error="errors.reason">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          :placeholder="t('portal.decline.reasonPlaceholder')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="danger" :loading="saving" @click="confirm">{{
        t('portal.decline.confirm')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-bottom: 16px;
}
</style>
