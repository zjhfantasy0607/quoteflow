<script setup lang="ts">
import { CONTRACT_SCAN_EXTS, type ContractDetailDto, type FileDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { contractsApi } from '@/api/contracts';
import FileUploader from '@/components/FileUploader.vue';

/** 签字扫描件（R14-6）：批准后上传签字盖章的纸质合同扫描件（PDF 或图片），记录上传时间；可以替换 */
const props = defineProps<{ contract: ContractDetailDto }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ uploaded: [ContractDetailDto] }>();

const { t } = useI18n();
const files = ref<FileDto[]>([]);
const saving = ref(false);

async function confirm(): Promise<void> {
  const file = files.value[0];
  if (!file) {
    ElMessage.warning(t('contracts.scan.required'));
    return;
  }
  saving.value = true;
  try {
    const updated = await contractsApi.signedScan(props.contract.id, file.id);
    ElMessage.success(t('contracts.scan.done'));
    visible.value = false;
    emit('uploaded', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (open) files.value = [];
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('contracts.scan.title')"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
  >
    <p class="hint">{{ t('contracts.scan.hint') }}</p>
    <p v-if="contract.signedScan" class="hint">
      {{ t('contracts.scan.current', { name: contract.signedScan.originalName }) }}
    </p>
    <FileUploader v-model="files" kind="ATTACHMENT" :exts="CONTRACT_SCAN_EXTS" :limit="1" />
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">{{
        t('common.actions.confirm')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
