<script setup lang="ts">
import type { AppConfigDto, FileDto, UploadKind } from '@quoteflow/shared';
import { ElMessage, type UploadRawFile, type UploadRequestOptions } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { filesApi } from '@/api/files';
import { apiError, translateError } from '@/api/http';
import { paramsApi } from '@/api/system';
import {
  acceptAttr,
  allowedExtsText,
  checkUpload,
  fileExtension,
  formatFileSize,
  maxUploadMB,
} from '@/utils/files';
import FilePreview from './FilePreview.vue';

/**
 * 先上传到 /api/files 拿到 FileDto，再由业务表单把 fileId 提交给业务接口（01 §5.4）。
 * 按 kind 预检类型和大小（R02-4），数量上限由 limit 控制；点文件名可预览。
 * exts 在 kind 允许的扩展名里再收窄（如合同签字扫描件只收 PDF 和图片）
 */
const props = withDefaults(
  defineProps<{ kind: UploadKind; limit?: number; disabled?: boolean; exts?: readonly string[] }>(),
  { limit: 10, disabled: false, exts: undefined },
);
const files = defineModel<FileDto[]>({ default: () => [] });

const { t } = useI18n();
const limits = ref<AppConfigDto['uploadLimits'] | null>(null);
const uploading = ref(0);
const previewing = ref<FileDto | null>(null);

const accept = computed(() =>
  props.exts ? props.exts.map((e) => `.${e}`).join(',') : acceptAttr(props.kind),
);
const extsText = computed(() => props.exts?.join(', ') ?? allowedExtsText(props.kind));
const full = computed(() => files.value.length + uploading.value >= props.limit);
const tip = computed(() => {
  const base = limits.value
    ? t('file.upload.tip', { exts: extsText.value, maxMB: maxUploadMB(props.kind, limits.value) })
    : extsText.value;
  return props.limit > 1 ? base + t('file.upload.tipLimit', { limit: props.limit }) : base;
});

function beforeUpload(raw: UploadRawFile): boolean {
  if (full.value) {
    ElMessage.warning(t('file.upload.tooMany', { limit: props.limit }));
    return false;
  }
  const problem =
    props.exts && !props.exts.includes(fileExtension(raw.name))
      ? 'type'
      : checkUpload(props.kind, raw, limits.value);
  if (problem === 'type') {
    ElMessage.error(t('file.upload.typeNotAllowed', { name: raw.name, exts: extsText.value }));
    return false;
  }
  if (problem === 'size') {
    ElMessage.error(
      t('file.upload.tooLarge', { name: raw.name, maxMB: maxUploadMB(props.kind, limits.value!) }),
    );
    return false;
  }
  return true;
}

async function doUpload(options: UploadRequestOptions): Promise<void> {
  uploading.value += 1;
  try {
    const dto = await filesApi.upload(options.file, props.kind);
    files.value = [...files.value, dto];
  } catch (err) {
    ElMessage.error(
      t('file.upload.failed', { name: options.file.name, reason: translateError(apiError(err)) }),
    );
  } finally {
    uploading.value -= 1;
  }
}

function remove(file: FileDto): void {
  files.value = files.value.filter((f) => f.id !== file.id);
}

onMounted(async () => {
  limits.value = (await paramsApi.appConfig().catch(() => null))?.uploadLimits ?? null;
});
</script>

<template>
  <div class="file-uploader">
    <el-upload
      v-if="!disabled"
      :show-file-list="false"
      :accept="accept"
      :multiple="limit > 1"
      :before-upload="beforeUpload"
      :http-request="doUpload"
    >
      <el-button icon="Upload" :loading="uploading > 0" :disabled="full">{{
        t('file.upload.button')
      }}</el-button>
    </el-upload>
    <div v-if="!disabled" class="tip">{{ tip }}</div>
    <ul v-if="files.length > 0" class="list">
      <li v-for="f in files" :key="f.id">
        <el-icon><Document /></el-icon>
        <el-button link type="primary" class="name" @click="previewing = f">{{ f.originalName }}</el-button>
        <span class="size">{{ formatFileSize(f.size) }}</span>
        <el-button v-if="!disabled" link type="danger" @click="remove(f)">{{
          t('file.upload.remove')
        }}</el-button>
      </li>
    </ul>

    <el-dialog
      :model-value="previewing !== null"
      :title="t('file.preview.title')"
      width="80%"
      top="5vh"
      append-to-body
      destroy-on-close
      @close="previewing = null"
    >
      <FilePreview v-if="previewing" :file="previewing" />
    </el-dialog>
  </div>
</template>

<style scoped>
.tip {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.name {
  max-width: 360px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.size {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
