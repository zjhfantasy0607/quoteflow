<script setup lang="ts">
import type { ImportResultDto } from '@quoteflow/shared';
import { ElMessage, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError } from '@/api/http';
import { importErrorView, type ImportErrorView } from '@/utils/excel';

/**
 * 标准 Excel 导入（#29、R02-9）：下载模板 → 选文件 → 导入 → 成功提示，或分"表头错误 / 行错误"展示。
 * upload 由业务模块提供（如材料导入接口），请求要带 silent，错误统一在这里展示。
 */
const props = defineProps<{ title: string; templateUrl: string; upload: (file: File) => Promise<ImportResultDto> }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [ImportResultDto] }>();

const { t } = useI18n();
const uploadRef = ref<UploadInstance>();
const file = ref<File | null>(null);
const importing = ref(false);
const error = ref<ImportErrorView | null>(null);

watch(visible, (open) => {
  if (!open) return;
  file.value = null;
  error.value = null;
  uploadRef.value?.clearFiles();
});

function onChange(f: UploadFile): void {
  file.value = f.raw ?? null;
  error.value = null;
}

/** 只保留一个文件：再选时替换掉之前的 */
function onExceed(files: File[]): void {
  uploadRef.value?.clearFiles();
  const raw = files[0] as UploadRawFile;
  uploadRef.value?.handleStart(raw);
}

async function start(): Promise<void> {
  if (!file.value) {
    ElMessage.warning(t('excel.import.chooseFile'));
    return;
  }
  importing.value = true;
  error.value = null;
  try {
    const result = await props.upload(file.value);
    ElMessage.success(t('excel.import.success', { created: result.created, updated: result.updated }));
    emit('imported', result);
    visible.value = false;
  } catch (err) {
    error.value = importErrorView(apiError(err));
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="720px" append-to-body>
    <ol class="steps">
      <li>
        <span>{{ t('excel.import.step1') }}</span>
        <el-button tag="a" :href="templateUrl" link type="primary" icon="Download">
          {{ t('excel.import.downloadTemplate') }}
        </el-button>
      </li>
      <li>{{ t('excel.import.step2') }}</li>
    </ol>

    <el-upload
      ref="uploadRef"
      drag
      accept=".xlsx"
      :auto-upload="false"
      :limit="1"
      :on-change="onChange"
      :on-remove="() => (file = null)"
      :on-exceed="onExceed"
    >
      <el-icon class="upload-icon"><UploadFilled /></el-icon>
      <div>{{ t('excel.import.drop') }}</div>
      <template #tip>
        <div class="tip">{{ t('excel.import.fileTip') }}</div>
      </template>
    </el-upload>

    <div v-if="error" class="errors">
      <el-alert v-if="error.kind === 'other'" :title="error.message" type="error" show-icon :closable="false" />
      <el-alert
        v-else-if="error.kind === 'header'"
        :title="t('excel.import.headerTitle')"
        type="error"
        show-icon
        :closable="false"
      >
        <div v-if="error.missing.length > 0">
          <strong>{{ t('excel.import.missing') }}</strong> {{ error.missing.join(', ') }}
        </div>
        <div v-if="error.extra.length > 0">
          <strong>{{ t('excel.import.extra') }}</strong> {{ error.extra.join(', ') }}
        </div>
        <div v-if="error.orderMismatch">{{ t('excel.import.orderMismatch') }}</div>
        <div>
          <strong>{{ t('excel.import.expected') }}</strong> {{ error.expected.join(' | ') }}
        </div>
      </el-alert>
      <template v-else>
        <el-alert
          :title="t('excel.import.rowsTitle', { total: error.total })"
          :description="error.total > error.rows.length ? t('excel.import.rowsTruncated', { shown: error.rows.length }) : ''"
          type="error"
          show-icon
          :closable="false"
        />
        <el-table :data="error.rows" max-height="300" size="small" class="row-errors">
          <el-table-column prop="row" :label="t('excel.import.columns.row')" width="80" />
          <el-table-column prop="column" :label="t('excel.import.columns.column')" min-width="180" />
          <el-table-column prop="message" :label="t('excel.import.columns.message')" min-width="220" />
        </el-table>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="importing" @click="start">{{ t('excel.import.start') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.steps {
  margin: 0 0 12px;
  padding-left: 20px;
  line-height: 2;
}
.steps li span {
  margin-right: 8px;
}
.upload-icon {
  margin-bottom: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 40px;
}
.tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.errors {
  margin-top: 16px;
}
.row-errors {
  margin-top: 8px;
}
</style>
