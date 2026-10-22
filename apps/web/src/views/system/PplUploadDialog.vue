<script setup lang="ts">
import type { PplDefinitionIssue, PplSetDto } from '@quoteflow/shared';
import { ElMessage, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { pplApi } from '@/api/system';
import { serverFieldErrors, type FieldErrors } from '@/utils/validate';

/** 上传模板集新版本：选 JSON → 服务端 validateDefinition() → 成功保存为新版本（未激活），失败逐条显示问题（R05-1） */
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [PplSetDto] }>();

const { t } = useI18n();
const uploadRef = ref<UploadInstance>();
const label = ref('');
const definition = ref<unknown>(undefined);
const fileError = ref('');
const errors = ref<FieldErrors>({});
const issues = ref<PplDefinitionIssue[]>([]);
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  label.value = '';
  definition.value = undefined;
  fileError.value = '';
  errors.value = {};
  issues.value = [];
  uploadRef.value?.clearFiles();
});

async function onChange(file: UploadFile): Promise<void> {
  definition.value = undefined;
  fileError.value = '';
  issues.value = [];
  if (!file.raw) return;
  try {
    definition.value = JSON.parse(await file.raw.text());
  } catch {
    fileError.value = t('system.ppl.uploadDialog.invalidJson');
    return;
  }
  const own = (definition.value as { label?: unknown } | null)?.label;
  if (!label.value && typeof own === 'string') label.value = own;
}

/** 只保留一个文件：再选时替换掉之前的 */
function onExceed(files: File[]): void {
  uploadRef.value?.clearFiles();
  uploadRef.value?.handleStart(files[0] as UploadRawFile);
}

async function submit(): Promise<void> {
  if (definition.value === undefined) {
    fileError.value ||= t('system.ppl.uploadDialog.chooseFile');
    return;
  }
  saving.value = true;
  errors.value = {};
  issues.value = [];
  try {
    const created = await pplApi.create({ label: label.value, definition: definition.value });
    ElMessage.success(t('system.ppl.uploadDialog.created', { version: created.version }));
    emit('created', created);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'PPL_DEFINITION_INVALID') issues.value = body.details as PplDefinitionIssue[];
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('system.ppl.uploadDialog.title')" width="760px" append-to-body>
    <el-form label-width="auto" @submit.prevent="submit">
      <el-form-item :label="t('system.ppl.uploadDialog.file')" :error="fileError" required>
        <el-upload
          ref="uploadRef"
          class="upload"
          drag
          accept=".json,application/json"
          :auto-upload="false"
          :limit="1"
          :on-change="onChange"
          :on-remove="() => (definition = undefined)"
          :on-exceed="onExceed"
        >
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div>{{ t('system.ppl.uploadDialog.drop') }}</div>
          <template #tip>
            <div class="tip">{{ t('system.ppl.uploadDialog.fileTip') }}</div>
          </template>
        </el-upload>
      </el-form-item>
      <el-form-item :label="t('system.ppl.uploadDialog.label')" :error="errors.label" required>
        <el-input
          v-model="label"
          maxlength="100"
          :placeholder="t('system.ppl.uploadDialog.labelPlaceholder')"
        />
      </el-form-item>
    </el-form>

    <div v-if="issues.length > 0" class="issues">
      <el-alert
        :title="t('system.ppl.uploadDialog.issuesTitle', { count: issues.length })"
        type="error"
        show-icon
        :closable="false"
      />
      <el-table :data="issues" max-height="320" size="small" class="issue-table">
        <el-table-column type="index" width="50" />
        <el-table-column
          prop="path"
          :label="t('system.ppl.uploadDialog.issueColumns.path')"
          min-width="220"
        />
        <el-table-column
          prop="message"
          :label="t('system.ppl.uploadDialog.issueColumns.message')"
          min-width="320"
        />
      </el-table>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{
        t('system.ppl.uploadDialog.submit')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upload {
  width: 100%;
}
.upload-icon {
  margin-bottom: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 40px;
}
.tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.issues {
  margin-top: 8px;
}
.issue-table {
  margin-top: 8px;
}
</style>
