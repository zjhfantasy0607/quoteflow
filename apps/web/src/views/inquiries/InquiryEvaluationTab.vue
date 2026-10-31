<script setup lang="ts">
import type {
  InquiryDetailDto,
  MatrixCellsDto,
  MatrixSupplierDto,
  PplResolvedColumn,
  PplValue,
  RoundMatrixDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import DictTag from '@/components/DictTag.vue';
import MaskedValue from '@/components/MaskedValue.vue';
import PplValueDisplay from '@/components/PplValueDisplay.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useDictStore } from '@/stores/dict';
import { downloadFile } from '@/utils/download';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import { columnLabel } from '@/utils/ppl';
import AwardDialog from './AwardDialog.vue';

/**
 * "比价评标"页签（M11 §5，参考 PPT #7、#8）：汇总表（每家一行，入围勾选最多 2 家、合计最低高亮、导出 Excel）→
 * 询价行切换 → 明细矩阵（行是 inMatrix 字段、列是各家当前版本；含税单价最低高亮，与上一版本相比变化的单元格高亮、
 * 悬停看原值；"只看差异"隐藏各家取值相同的字段）。没有 quote.amount 时金额显示 🔒、不标最低价。
 * M12：评标中时工具栏有"定标"按钮（inquiry:award），定标后把最新详情交给详情页刷新。
 * M13：roundNo 指定查看哪一轮（默认当前轮次）；开过标的旧轮次只读（不能入围、定标），照样能导出
 */
const props = defineProps<{ inquiry: InquiryDetailDto; refreshKey?: number; roundNo?: number }>();
const emit = defineEmits<{ shortlisted: []; awarded: [InquiryDetailDto] }>();

const { t, locale } = useI18n();
const dict = useDictStore();

const matrix = ref<RoundMatrixDto | null>(null);
const loading = ref(false);
const sealed = ref(false);
const saving = ref(false);
const exporting = ref(false);
const awardVisible = ref(false);
const lineId = ref('');
const onlyDiff = ref(false);

const UNIT_PRICE_KEY = 'unit_price_incl_tax';
const canExport = computed(() => props.inquiry.allowedActions.includes('exportMatrix'));
const viewRoundNo = computed(() => props.roundNo ?? props.inquiry.currentRoundNo);
const canAward = computed(
  () => viewRoundNo.value === props.inquiry.currentRoundNo && props.inquiry.allowedActions.includes('award'),
);
const opened = computed(() => matrix.value?.roundStatus !== 'WAITING_QUOTES');
const quoted = computed(() => matrix.value?.suppliers.filter((s) => s.quoted) ?? []);
const shortlistCount = computed(() => matrix.value?.suppliers.filter((s) => s.shortlisted).length ?? 0);
const limit = computed(() => matrix.value?.shortlistLimit ?? 2);
/** 没有 quote.amount 时合计被脱敏，明细里 sensitive 的列也一样 */
const amountMasked = computed(
  () => matrix.value?.suppliers.some((s) => s.maskedFields?.includes('totalAmount')) ?? false,
);
const line = computed(
  () => matrix.value?.lines.find((l) => l.lineId === lineId.value) ?? matrix.value?.lines[0],
);

interface DetailRow {
  column: PplResolvedColumn;
  cells: MatrixCellsDto[];
}
const sameAll = (values: (PplValue | null)[]) => {
  const norm = values.map((v) => JSON.stringify(Array.isArray(v) ? [...v].sort() : (v ?? null)));
  return norm.every((v) => v === norm[0]);
};
const detailRows = computed<DetailRow[]>(() => {
  const l = line.value;
  if (!matrix.value || !l) return [];
  const rows = matrix.value.columns.map((column) => ({ column, cells: l.quotes }));
  if (!onlyDiff.value) return rows;
  return rows.filter(
    (r) =>
      !sameAll(r.cells.map((c) => c.values[r.column.key] ?? null)) ||
      r.cells.some((c) => r.column.key in c.changes),
  );
});

const cellMasked = (column: PplResolvedColumn) => amountMasked.value && !!column.sensitive;
const isChanged = (cell: MatrixCellsDto, key: string) => key in cell.changes;
function cellClass({ row, columnIndex }: { row: DetailRow; columnIndex: number }): string {
  const cell = row.cells[columnIndex - 1];
  if (!cell) return '';
  const classes: string[] = [];
  if (row.column.key === UNIT_PRICE_KEY && cell.lowestUnitPrice) classes.push('is-lowest');
  if (isChanged(cell, row.column.key)) classes.push('is-changed');
  return classes.join(' ');
}

// ---------- 入围 ----------
const selectable = (row: MatrixSupplierDto) =>
  !!matrix.value?.canShortlist && row.quoted && row.status === 'EVALUATING';
const locked = (row: MatrixSupplierDto) => row.shortlisted && (row.negotiation?.messageCount ?? 0) > 0;
function shortlistBlock(row: MatrixSupplierDto): string | null {
  if (!selectable(row)) return t('inquiries.evaluation.shortlistInvalid');
  if (locked(row)) return t('inquiries.evaluation.shortlistLocked');
  if (!row.shortlisted && shortlistCount.value >= limit.value)
    return t('inquiries.evaluation.shortlistFull', { limit: limit.value });
  return null;
}

async function toggle(row: MatrixSupplierDto, checked: boolean): Promise<void> {
  const ids = matrix
    .value!.suppliers.filter((s) => s.shortlisted && s.quoteId !== row.quoteId)
    .map((s) => s.quoteId);
  if (checked) ids.push(row.quoteId);
  saving.value = true;
  try {
    matrix.value = await inquiriesApi.shortlist(props.inquiry.id, props.inquiry.currentRoundNo, ids);
    ElMessage.success(t('inquiries.evaluation.shortlistSaved'));
    emit('shortlisted');
  } catch {
    // 错误提示由 http 拦截器显示；名单可能已被别人改过，重新加载
    await load();
  } finally {
    saving.value = false;
  }
}

async function exportMatrix(): Promise<void> {
  exporting.value = true;
  try {
    await downloadFile(
      inquiriesApi.matrixExportUrl(props.inquiry.id, viewRoundNo.value),
      undefined,
      'matrix.xlsx',
    );
  } finally {
    exporting.value = false;
  }
}

/** 定标后轮次评标完成：矩阵里的状态变成已中标 / 未中标、不能再入围 */
async function onAwarded(updated: InquiryDetailDto): Promise<void> {
  emit('awarded', updated);
  await load();
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const m = await inquiriesApi.matrix(props.inquiry.id, viewRoundNo.value);
    matrix.value = m;
    sealed.value = false;
    if (!m.lines.some((l) => l.lineId === lineId.value)) lineId.value = m.lines[0]?.lineId ?? '';
    const types = m.columns.filter((c) => c.dictType).map((c) => c.dictType!);
    void dict.load([...new Set(types)]);
  } catch (err) {
    const body = apiError(err);
    sealed.value = body?.code === 'QUOTE_SEALED';
    if (!sealed.value) ElMessage.error(translateError(body));
  } finally {
    loading.value = false;
  }
}

watch(() => [props.inquiry.id, viewRoundNo.value, props.refreshKey], load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <el-result v-if="sealed" icon="info" :title="t('inquiries.evaluation.sealed')" />
    <template v-if="matrix">
      <div class="toolbar">
        <span class="section-title">{{ t('inquiries.evaluation.summary') }}</span>
        <span class="muted">
          {{ t('inquiries.evaluation.shortlistCount', { count: shortlistCount, limit }) }}
          <template v-if="matrix.canShortlist">
            · {{ t('inquiries.evaluation.shortlistHint', { limit }) }}</template
          >
        </span>
        <span class="spacer" />
        <el-button v-if="canExport" icon="Download" :loading="exporting" @click="exportMatrix">
          {{ t('inquiries.evaluation.export') }}
        </el-button>
        <el-button v-if="canAward" type="primary" icon="Trophy" @click="awardVisible = true">
          {{ t('inquiries.award.button') }}
        </el-button>
      </div>
      <!-- 列宽合计约 1080px（中英文都放得下）：1440 宽时页签区可用 1115px，不横向滚动；以后加列要重新核对 -->
      <el-table
        v-loading="saving"
        :data="matrix.suppliers"
        row-key="quoteId"
        class="summary"
        :empty-text="t('common.table.empty')"
      >
        <el-table-column
          :label="t('inquiries.evaluation.fields.shortlist')"
          width="84"
          align="center"
          fixed="left"
        >
          <template #default="{ row }">
            <el-tooltip
              :content="shortlistBlock(row) ?? ''"
              :disabled="!shortlistBlock(row) || !matrix.canShortlist"
              placement="top"
            >
              <span>
                <el-checkbox
                  :model-value="row.shortlisted"
                  :disabled="!!shortlistBlock(row) || saving"
                  @change="(v: string | number | boolean) => toggle(row, v === true)"
                />
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column
          :label="t('inquiries.evaluation.fields.supplier')"
          width="150"
          fixed="left"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <span class="code">{{ row.supplier.code }}</span>
            {{ pickName(row.supplier, locale) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.status')" width="136">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'INVITED' && opened" type="info" effect="plain" disable-transitions>
              {{ t('inquiries.evaluation.noResponse') }}
            </el-tag>
            <StatusTag v-else enum-name="QuoteStatus" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.total')" width="150" align="right">
          <template #default="{ row }">
            <template v-if="row.quoted">
              <MaskedValue :masked="!!row.maskedFields?.includes('totalAmount')">
                <span :class="['amount', { lowest: row.lowestTotal }]">
                  {{ row.currency }} {{ formatMoney(row.totalAmount, 2) }}
                </span>
                <el-tag
                  v-if="row.lowestTotal"
                  type="success"
                  size="small"
                  class="lowest-tag"
                  disable-transitions
                >
                  {{ t('inquiries.evaluation.lowest') }}
                </el-tag>
              </MaskedValue>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.maxLeadTime')" width="100" align="right">
          <template #default="{ row }">{{ row.maxLeadTimeDays ?? '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.version')" width="140">
          <template #default="{ row }">
            <template v-if="row.currentVersionNo">
              {{ t('ppl.versions.version', { no: row.currentVersionNo }) }}
              <el-tag
                v-if="row.currentVersionSource === 'NEGOTIATION'"
                size="small"
                type="warning"
                effect="plain"
                disable-transitions
              >
                {{ t('enums.QuoteVersionSource.NEGOTIATION') }}
              </el-tag>
            </template>
            <span v-else class="muted">—</span>
            <div v-if="row.lastSubmittedAt" class="sub">{{ formatDateTime(row.lastSubmittedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.note')" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.status === 'DECLINED'">
              <DictTag
                v-if="row.declineReasonCode"
                type="decline_reason"
                :code="row.declineReasonCode"
                plain
              />
              <span v-if="row.declineReason" class="reason">{{ row.declineReason }}</span>
            </template>
            <span v-else>{{ row.changeNote ?? '' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.evaluation.fields.negotiation')" width="126">
          <template #default="{ row }">
            <template v-if="row.negotiation">
              <StatusTag enum-name="NegotiationStatus" :value="row.negotiation.status" />
              <div v-if="row.negotiation.status === 'OPEN' && row.negotiation.awaiting" class="awaiting">
                {{
                  row.negotiation.awaiting === 'BUYER'
                    ? t('inquiries.evaluation.awaitingBuyer')
                    : t('inquiries.evaluation.awaitingSupplier')
                }}
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.table.actions')" width="84" fixed="right">
          <template #default="{ row }">
            <router-link
              v-if="row.versionCount > 0"
              :to="{
                name: 'inquiry-quote',
                params: { id: inquiry.id, roundNo: matrix.roundNo, quoteId: row.quoteId },
              }"
              class="view-link"
            >
              {{ t('inquiries.evaluation.viewQuote') }}
            </router-link>
          </template>
        </el-table-column>
      </el-table>

      <div class="toolbar detail-toolbar">
        <span class="section-title">{{ t('inquiries.evaluation.detail') }}</span>
        <el-select
          v-model="lineId"
          filterable
          class="line-select"
          :placeholder="t('inquiries.evaluation.line')"
        >
          <el-option
            v-for="l in matrix.lines"
            :key="l.lineId"
            :value="l.lineId"
            :label="t('inquiries.evaluation.lineOption', { no: l.lineNo, name: pickName(l, locale) })"
          />
        </el-select>
        <span v-if="line" class="muted">
          {{ line.spec }} ·
          {{
            t('inquiries.evaluation.lineQuantity', {
              quantity: line.quantity,
              unit: pickName({ nameZh: line.unitNameZh, nameEn: line.unitNameEn }, locale),
            })
          }}
        </span>
        <span class="spacer" />
        <el-switch v-model="onlyDiff" :active-text="t('inquiries.evaluation.onlyDiff')" />
      </div>
      <div class="legend">
        <span><i class="swatch swatch-lowest" />{{ t('inquiries.evaluation.legendLowest') }}</span>
        <span><i class="swatch swatch-changed" />{{ t('inquiries.evaluation.legendChanged') }}</span>
      </div>
      <el-empty
        v-if="quoted.length === 0"
        :description="t('inquiries.evaluation.noQuotes')"
        :image-size="64"
      />
      <el-table
        v-else
        :data="detailRows"
        border
        :cell-class-name="cellClass"
        class="detail"
        :empty-text="t('inquiries.evaluation.noDiff')"
      >
        <el-table-column :label="t('inquiries.evaluation.fields.field')" width="170" fixed="left">
          <template #default="{ row }">{{ columnLabel(row.column, locale) }}</template>
        </el-table-column>
        <el-table-column
          v-for="(s, i) in quoted"
          :key="s.quoteId"
          :label="`${s.supplier.code} ${pickName(s.supplier, locale)}`"
          min-width="170"
        >
          <template #default="{ row }">
            <el-tooltip v-if="isChanged(row.cells[i], row.column.key)" placement="top">
              <template #content>
                {{ t('inquiries.evaluation.was', { value: '' }) }}
                <PplValueDisplay
                  v-if="row.cells[i].changes[row.column.key] !== null"
                  :column="row.column"
                  :value="row.cells[i].changes[row.column.key]"
                />
                <span v-else>{{ t('inquiries.evaluation.empty') }}</span>
              </template>
              <span class="cell">
                <PplValueDisplay
                  :column="row.column"
                  :value="row.cells[i].values[row.column.key]"
                  :masked="cellMasked(row.column)"
                />
              </span>
            </el-tooltip>
            <PplValueDisplay
              v-else
              :column="row.column"
              :value="row.cells[i].values[row.column.key]"
              :masked="cellMasked(row.column)"
            />
          </template>
        </el-table-column>
      </el-table>
      <AwardDialog
        v-model="awardVisible"
        :inquiry="inquiry"
        :suppliers="matrix.suppliers"
        @awarded="onAwarded"
      />
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.detail-toolbar {
  margin-top: 24px;
}
.section-title {
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.code {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.amount {
  font-variant-numeric: tabular-nums;
}
.amount.lowest {
  color: var(--el-color-success);
  font-weight: 600;
}
.lowest-tag {
  margin-left: 6px;
}
.reason {
  margin-left: 6px;
}
.awaiting,
.sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.view-link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.line-select {
  width: 320px;
}
.legend {
  display: flex;
  gap: 20px;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  vertical-align: -2px;
  border-radius: 2px;
}
.swatch-lowest {
  background: var(--el-color-success-light-8);
}
/* 变化：浅橙底 + 左侧橙条；最低价：浅绿底加粗。两者同时成立时绿底 + 橙条 */
.swatch-changed {
  background: var(--el-color-warning-light-8);
  box-shadow: inset 3px 0 0 var(--el-color-warning);
}
.detail :deep(td.is-changed) {
  background: var(--el-color-warning-light-8);
  box-shadow: inset 3px 0 0 var(--el-color-warning);
}
.detail :deep(td.is-lowest) {
  background: var(--el-color-success-light-8);
  font-weight: 600;
}
.cell {
  cursor: help;
}
</style>
