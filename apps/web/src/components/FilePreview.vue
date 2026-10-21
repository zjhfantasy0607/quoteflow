<script setup lang="ts">
import type { FileDto, SheetPreviewDto } from '@quoteflow/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { filesApi } from '@/api/files';
import { columnLetter, previewMode } from '@/utils/files';

/** PDF 用浏览器内置查看器，图片可放大，xlsx 按工作表显示表格，其他格式只能下载（A-17） */
const props = defineProps<{ file: Pick<FileDto, 'id' | 'originalName'> }>();

const { t } = useI18n();
const mode = computed(() => previewMode(props.file.originalName));
const inlineUrl = computed(() => filesApi.contentUrl(props.file.id, 'inline'));
const downloadUrl = computed(() => filesApi.contentUrl(props.file.id, 'attachment'));

const sheet = ref<SheetPreviewDto | null>(null);
const activeSheet = ref('0');
const loading = ref(false);
const failed = ref(false);

watch(
  () => props.file.id,
  async (id) => {
    sheet.value = null;
    failed.value = false;
    activeSheet.value = '0';
    if (mode.value !== 'sheet') return;
    loading.value = true;
    try {
      sheet.value = await filesApi.sheetPreview(id);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function columns(rows: string[][]): string[] {
  const count = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: count }, (_, i) => columnLetter(i));
}
</script>

<template>
  <div class="file-preview">
    <div class="toolbar">
      <span class="name">{{ file.originalName }}</span>
      <el-button tag="a" :href="downloadUrl" icon="Download">{{ t('file.preview.download') }}</el-button>
    </div>

    <iframe v-if="mode === 'pdf'" :src="inlineUrl" :title="file.originalName" class="pdf" />

    <div v-else-if="mode === 'image'" class="image">
      <el-image :src="inlineUrl" :preview-src-list="[inlineUrl]" fit="contain" preview-teleported />
    </div>

    <div v-else-if="mode === 'sheet'" v-loading="loading" class="sheet">
      <el-alert v-if="failed" :title="t('file.preview.loadFailed')" type="error" show-icon :closable="false" />
      <el-tabs v-else-if="sheet" v-model="activeSheet">
        <el-tab-pane v-for="(s, i) in sheet.sheets" :key="i" :label="s.name" :name="String(i)">
          <el-empty v-if="s.rows.length === 0" :description="t('file.preview.emptySheet')" />
          <div v-else class="grid-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th />
                  <th v-for="c in columns(s.rows)" :key="c">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, r) in s.rows" :key="r">
                  <th>{{ r + 1 }}</th>
                  <td v-for="(c, ci) in columns(s.rows)" :key="c">{{ row[ci] ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="s.truncated" class="note">{{ t('file.preview.truncated') }}</div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-empty v-else :description="t('file.preview.notSupported')" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.name {
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pdf {
  width: 100%;
  height: 72vh;
  border: 1px solid var(--el-border-color);
}
.image {
  display: flex;
  justify-content: center;
}
.image .el-image {
  max-height: 72vh;
}
.grid-wrap {
  max-height: 64vh;
  overflow: auto;
  border: 1px solid var(--el-border-color);
}
.grid {
  border-collapse: collapse;
  font-size: 12px;
}
.grid th,
.grid td {
  min-width: 64px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color-lighter);
  white-space: nowrap;
}
.grid thead th {
  position: sticky;
  top: 0;
  background: var(--el-fill-color-light);
}
.grid tbody th {
  min-width: 40px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
}
.note {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
