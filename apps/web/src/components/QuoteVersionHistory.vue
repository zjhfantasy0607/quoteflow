<script setup lang="ts">
import type {
  FileDto,
  PplGroup,
  PplResolvedColumn,
  QuoteVersionDto,
  QuoteVersionSummaryDto,
} from '@quoteflow/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime, formatMoney } from '@/utils/format';
import type { PplSheetLine } from '@/utils/ppl';
import FilePreview from './FilePreview.vue';
import MaskedValue from './MaskedValue.vue';
import PplLineTable from './PplLineTable.vue';

/**
 * 报价的历史版本（R09-7，参考 PPT #9）：时间线（版本号、提交时间、含税合计、来源、备注），点开看只读的版本明细。
 * 门户（供应商看自己的）与采购方报价详情（M10，开标后；没有 quote.amount 时合计和金额列显示 🔒）共用
 */
const props = defineProps<{
  versions: readonly QuoteVersionSummaryDto[];
  /** 当前版本号（时间线上高亮）；还没提交过为 null */
  currentNo: number | null;
  groups: readonly PplGroup[];
  columns: readonly PplResolvedColumn[];
  lines: readonly PplSheetLine[];
  fetchVersion: (versionNo: number) => Promise<QuoteVersionDto>;
  loading?: boolean;
}>();

const { t } = useI18n();

const viewing = ref<QuoteVersionDto | null>(null);
const previewing = ref<FileDto | null>(null);

const viewingValues = computed(() =>
  Object.fromEntries((viewing.value?.lines ?? []).map((l) => [l.lineId, l.values])),
);
const totalMasked = (v: QuoteVersionSummaryDto) => v.maskedFields?.includes('totalAmount') ?? false;
const total = (v: QuoteVersionSummaryDto) => `${v.currency} ${formatMoney(v.totalAmount ?? '', 2)}`;

async function view(versionNo: number): Promise<void> {
  viewing.value = await props.fetchVersion(versionNo);
}
</script>

<template>
  <el-timeline v-loading="loading" class="timeline">
    <el-timeline-item
      v-for="v in versions"
      :key="v.versionNo"
      :timestamp="`${formatDateTime(v.submittedAt)} ${t('common.tz')}`"
      :type="v.versionNo === currentNo ? 'primary' : undefined"
      placement="top"
    >
      <div class="line">
        <strong>{{ t('ppl.versions.version', { no: v.versionNo }) }}</strong>
        <el-tag v-if="v.versionNo === currentNo" size="small" type="success" disable-transitions>
          {{ t('ppl.versions.current') }}
        </el-tag>
        <el-tag size="small" type="info" disable-transitions>{{
          t(`enums.QuoteVersionSource.${v.source}`)
        }}</el-tag>
        <span class="amount">
          <template v-if="totalMasked(v)">
            {{ t('ppl.versions.totalLabel') }} <MaskedValue masked />
          </template>
          <template v-else>{{ t('ppl.versions.total', { amount: total(v) }) }}</template>
        </span>
        <span class="muted">{{ t('ppl.versions.submittedBy', { name: v.submittedBy.name }) }}</span>
        <el-button link type="primary" @click="view(v.versionNo)">{{ t('ppl.versions.view') }}</el-button>
      </div>
      <div v-if="v.changeNote" class="note">
        {{ t('ppl.versions.changeNoteValue', { text: v.changeNote }) }}
      </div>
      <div v-if="v.remark" class="note">{{ t('ppl.versions.remarkValue', { text: v.remark }) }}</div>
    </el-timeline-item>
  </el-timeline>

  <el-dialog
    :model-value="viewing !== null"
    :title="
      viewing
        ? t('ppl.versions.detailTitle', {
            no: viewing.versionNo,
            time: `${formatDateTime(viewing.submittedAt)} ${t('common.tz')}`,
          })
        : ''
    "
    width="90%"
    top="5vh"
    append-to-body
    destroy-on-close
    @close="viewing = null"
  >
    <template v-if="viewing">
      <el-descriptions :column="3" border class="meta">
        <el-descriptions-item :label="t('ppl.versions.source')">
          {{ t(`enums.QuoteVersionSource.${viewing.source}`) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('ppl.versions.totalLabel')">
          <MaskedValue :masked="totalMasked(viewing)">{{ total(viewing) }}</MaskedValue>
        </el-descriptions-item>
        <el-descriptions-item :label="t('ppl.versions.attachments')">
          <div v-for="f in viewing.attachments" :key="f.id">
            <el-button link type="primary" @click="previewing = f">{{ f.originalName }}</el-button>
          </div>
          <span v-if="viewing.attachments.length === 0">—</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('ppl.versions.remark')" :span="3">
          <span class="pre">{{ viewing.remark ?? '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('ppl.versions.changeNote')" :span="3">
          <span class="pre">{{ viewing.changeNote ?? '—' }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <PplLineTable
        :values="viewingValues"
        :groups="groups"
        :columns="columns"
        :lines="lines"
        :currency="viewing.currency"
        :masked-fields="viewing.maskedFields"
        readonly
      />
    </template>
  </el-dialog>
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
</template>

<style scoped>
.timeline {
  padding-left: 4px;
}
.line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.amount {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-variant-numeric: tabular-nums;
}
.note {
  margin-top: 4px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  white-space: pre-wrap;
}
.meta {
  margin-bottom: 12px;
}
.pre {
  white-space: pre-wrap;
}
</style>
