<script setup lang="ts">
import { CONTRACT_ATTACHMENTS_MAX, type ContractDetailDto, type FileDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { contractsApi } from '@/api/contracts';
import FileUploader from '@/components/FileUploader.vue';

/**
 * 编辑合同（R14-2）：只有草稿能改交付日期、交付地点、付款方式、合同摘要、备注和附件；金额、供应商、快照不可改。
 * 交付日期、交付地点、付款方式在提交审核时才必填（R14-3），保存时可以先空着。保存是整体替换，附件按当前列表提交
 */
const props = defineProps<{ contract: ContractDetailDto }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [ContractDetailDto] }>();

const { t } = useI18n();
const saving = ref(false);
const form = reactive({
  deliveryDate: null as string | null,
  deliveryPlace: '',
  paymentTerms: '',
  summary: '',
  remark: '',
  attachments: [] as FileDto[],
});

async function save(): Promise<void> {
  saving.value = true;
  try {
    const updated = await contractsApi.update(props.contract.id, {
      deliveryDate: form.deliveryDate ?? undefined,
      deliveryPlace: form.deliveryPlace,
      paymentTerms: form.paymentTerms,
      summary: form.summary,
      remark: form.remark,
      attachmentFileIds: form.attachments.map((f) => f.id),
    });
    ElMessage.success(t('contracts.edit.saved'));
    visible.value = false;
    emit('saved', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (!open) return;
  const c = props.contract;
  Object.assign(form, {
    deliveryDate: c.deliveryDate,
    deliveryPlace: c.deliveryPlace ?? '',
    paymentTerms: c.paymentTerms ?? '',
    summary: c.summary ?? '',
    remark: c.remark ?? '',
    attachments: [...c.attachments],
  });
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('contracts.edit.title')"
    width="640px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form label-position="top" class="contract-form">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="t('contracts.fields.deliveryDate')" required>
            <el-date-picker
              v-model="form.deliveryDate"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="t('contracts.edit.deliveryDatePlaceholder')"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="t('contracts.fields.deliveryPlace')" required>
            <el-input v-model="form.deliveryPlace" maxlength="200" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="t('contracts.fields.paymentTerms')" required>
        <el-input v-model="form.paymentTerms" maxlength="200" />
      </el-form-item>
      <el-form-item :label="t('contracts.fields.summary')">
        <el-input v-model="form.summary" type="textarea" :rows="3" maxlength="1000" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('contracts.fields.remark')">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="1000" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('contracts.fields.attachments')">
        <FileUploader v-model="form.attachments" kind="ATTACHMENT" :limit="CONTRACT_ATTACHMENTS_MAX" />
      </el-form-item>
    </el-form>
    <p class="hint">{{ t('contracts.edit.requiredHint') }}</p>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.contract-form :deep(.el-form-item__content) {
  display: block;
}
.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
