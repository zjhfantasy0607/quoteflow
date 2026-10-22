<script setup lang="ts">
import type { AppConfigDto, InquiryLineDto, InquiryRoundDto } from '@quoteflow/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { paramsApi } from '@/api/system';
import { pickName } from '@/utils/format';
import CopyFilesDialog from './CopyFilesDialog.vue';
import LineFilesCell from './LineFilesCell.vue';

/** 规格书与产品图（R06-5）：整单规格书 + 每行的规格书和产品图，"复制到其他行" */
defineProps<{ inquiryId: string; round: InquiryRoundDto; editable: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const { t, locale } = useI18n();
const limits = ref<AppConfigDto['uploadLimits'] | null>(null);
const copyFrom = ref<InquiryLineDto | null>(null);
const copyVisible = ref(false);

function openCopy(line: InquiryLineDto): void {
  copyFrom.value = line;
  copyVisible.value = true;
}

onMounted(async () => {
  limits.value = (await paramsApi.appConfig().catch(() => null))?.uploadLimits ?? null;
});
</script>

<template>
  <div class="files-section">
    <div class="block">
      <div class="block-title">{{ t('inquiries.files.wholeTitle') }}</div>
      <div class="hint">{{ t('inquiries.files.wholeHint') }}</div>
      <LineFilesCell
        :inquiry-id="inquiryId"
        :round-no="round.roundNo"
        :line-id="null"
        kind="SPEC_DOC"
        :files="round.files"
        :editable="editable"
        :limits="limits"
        @changed="emit('changed')"
      />
    </div>

    <div class="block">
      <div class="block-title">{{ t('inquiries.files.lineTitle') }}</div>
      <el-table :data="round.lines" :empty-text="t('inquiries.lines.empty')" row-key="id">
        <el-table-column :label="t('inquiries.lines.fields.lineNo')" prop="lineNo" width="64" />
        <el-table-column :label="t('inquiries.lines.fields.name')" min-width="180">
          <template #default="{ row }">
            <div>{{ pickName(row, locale) }}</div>
            <div class="sub">{{ row.spec }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.files.specDocs')" min-width="240">
          <template #default="{ row }">
            <LineFilesCell
              :inquiry-id="inquiryId"
              :round-no="round.roundNo"
              :line-id="row.id"
              kind="SPEC_DOC"
              :files="row.files"
              :editable="editable"
              :limits="limits"
              @changed="emit('changed')"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.files.images')" min-width="280">
          <template #default="{ row }">
            <LineFilesCell
              :inquiry-id="inquiryId"
              :round-no="round.roundNo"
              :line-id="row.id"
              kind="PRODUCT_IMAGE"
              :files="row.files"
              :editable="editable"
              :limits="limits"
              @changed="emit('changed')"
            />
          </template>
        </el-table-column>
        <el-table-column v-if="editable" :label="t('common.table.actions')" width="140">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="row.files.length === 0 || round.lines.length < 2"
              @click="openCopy(row)"
            >
              {{ t('inquiries.files.copy') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <CopyFilesDialog
      v-model="copyVisible"
      :inquiry-id="inquiryId"
      :round-no="round.roundNo"
      :lines="round.lines"
      :from="copyFrom"
      @copied="emit('changed')"
    />
  </div>
</template>

<style scoped>
.files-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.block-title {
  margin-bottom: 4px;
  font-weight: 600;
}
.hint,
.sub {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.sub {
  margin-bottom: 0;
}
</style>
