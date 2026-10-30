<script setup lang="ts">
import type { AppConfigDto, FileDto, InquiryFileDto, InquiryFileKind } from '@quoteflow/shared';
import { ElMessage, type UploadRawFile, type UploadRequestOptions } from 'element-plus';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { filesApi } from '@/api/files';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import FilePreview from '@/components/FilePreview.vue';
import { confirmAction } from '@/utils/dialogs';
import { acceptAttr, allowedExtsText, checkUpload, maxUploadMB } from '@/utils/files';

/**
 * 一行（lineId 为空 = 整单）某一类附件（R06-5）：先上传到 /api/files，再挂到询价行上；
 * 产品图显示"已上传 n/上限"，到上限后不能再传
 */
const props = defineProps<{
  inquiryId: string;
  roundNo: number;
  lineId: string | null;
  kind: InquiryFileKind;
  /** 本行（或整单）的全部附件，组件只显示 kind 这一类 */
  files: InquiryFileDto[];
  editable: boolean;
  limits: AppConfigDto['uploadLimits'] | null;
}>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const uploading = ref(0);
const previewing = ref<FileDto | null>(null);

const items = computed(() => props.files.filter((f) => f.kind === props.kind));
const isImage = computed(() => props.kind === 'PRODUCT_IMAGE');
const max = computed(() => props.limits?.imagesPerLine ?? 10);
const full = computed(() => isImage.value && items.value.length + uploading.value >= max.value);
// 缩略图不记访问日志，点开放大（preview-src-list）用普通地址，照样记（R08-3）
const imageUrl = (f: InquiryFileDto) => filesApi.contentUrl(f.file.id, 'inline', true);
const imageUrls = computed(() => items.value.map((f) => filesApi.contentUrl(f.file.id, 'inline')));

function beforeUpload(raw: UploadRawFile): boolean {
  if (full.value) {
    ElMessage.warning(t('inquiries.files.imagesFull', { max: max.value }));
    return false;
  }
  const problem = checkUpload(props.kind, raw, props.limits);
  if (problem === 'type') {
    ElMessage.error(t('file.upload.typeNotAllowed', { name: raw.name, exts: allowedExtsText(props.kind) }));
    return false;
  }
  if (problem === 'size') {
    ElMessage.error(
      t('file.upload.tooLarge', { name: raw.name, maxMB: maxUploadMB(props.kind, props.limits!) }),
    );
    return false;
  }
  return true;
}

async function doUpload(options: UploadRequestOptions): Promise<void> {
  uploading.value += 1;
  try {
    const file = await filesApi.upload(options.file, props.kind);
    await inquiriesApi.attachFile(props.inquiryId, props.roundNo, {
      fileId: file.id,
      kind: props.kind,
      lineId: props.lineId,
    });
    emit('changed');
  } catch (err) {
    ElMessage.error(
      t('file.upload.failed', { name: options.file.name, reason: translateError(apiError(err)) }),
    );
  } finally {
    uploading.value -= 1;
  }
}

async function remove(f: InquiryFileDto): Promise<void> {
  if (!(await confirmAction(t('inquiries.files.deleteConfirm', { name: f.file.originalName })))) return;
  try {
    await inquiriesApi.removeFile(props.inquiryId, props.roundNo, f.id);
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  emit('changed');
}
</script>

<template>
  <div class="line-files">
    <template v-if="isImage">
      <div v-if="items.length > 0" class="thumbs">
        <div v-for="(f, i) in items" :key="f.id" class="thumb-wrap">
          <el-image
            :src="imageUrl(f)"
            :preview-src-list="imageUrls"
            :initial-index="i"
            :title="f.file.originalName"
            fit="cover"
            class="thumb"
            preview-teleported
            hide-on-click-modal
          />
          <el-button
            v-if="editable"
            class="thumb-remove"
            circle
            size="small"
            type="danger"
            icon="Close"
            :aria-label="t('common.actions.delete')"
            @click="remove(f)"
          />
        </div>
      </div>
      <div class="count">{{ t('inquiries.files.imageCount', { count: items.length, max }) }}</div>
    </template>
    <template v-else>
      <ul v-if="items.length > 0" class="docs">
        <li v-for="f in items" :key="f.id">
          <el-icon><Document /></el-icon>
          <el-button
            link
            type="primary"
            class="doc-name"
            :title="f.file.originalName"
            @click="previewing = f.file"
          >
            {{ f.file.originalName }}
          </el-button>
          <el-button
            v-if="editable"
            link
            type="danger"
            icon="Delete"
            :aria-label="t('common.actions.delete')"
            @click="remove(f)"
          />
        </li>
      </ul>
      <span v-else-if="!editable" class="none">{{ t('inquiries.files.none') }}</span>
    </template>

    <el-upload
      v-if="editable && !full"
      :show-file-list="false"
      :accept="acceptAttr(kind)"
      multiple
      :before-upload="beforeUpload"
      :http-request="doUpload"
      class="uploader"
    >
      <el-button size="small" icon="Upload" :loading="uploading > 0">
        {{ isImage ? t('inquiries.files.uploadImage') : t('inquiries.files.uploadSpec') }}
      </el-button>
    </el-upload>

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
.line-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.thumb-wrap {
  position: relative;
}
.thumb {
  display: block;
  width: 48px;
  height: 48px;
  border-radius: 4px;
}
.thumb-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  font-size: 10px;
}
.count,
.none {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.docs {
  margin: 0;
  padding: 0;
  list-style: none;
}
.docs li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.doc-name {
  max-width: 220px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.uploader {
  line-height: 1;
}
</style>
