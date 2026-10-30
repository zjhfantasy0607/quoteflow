<script setup lang="ts">
import type { PplGroup, PplResolvedColumn } from '@quoteflow/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pickLabel } from '@/utils/format';
import {
  liveRow,
  pplErrorText,
  requiredProgress,
  type PplErrorMap,
  type PplRawValues,
  type PplSheetLine,
} from '@/utils/ppl';
import PplForm from './PplForm.vue';
import PplValueDisplay from './PplValueDisplay.vue';
import PplValueInput from './PplValueInput.vue';

/**
 * PPL 报价行表格（M09 §5）：每行显示 keyField 列，供应商列可以直接改，"编辑全部字段"打开 PplForm 抽屉。
 * readonly 时显示版本里存的取值（含公式列、被脱敏的列显示 🔒）。后面比价矩阵、合同快照复用。
 * open(lineId, key) 供页面定位到出错的行和字段（R09-11）
 */
const props = defineProps<{
  groups: readonly PplGroup[];
  columns: readonly PplResolvedColumn[];
  lines: readonly PplSheetLine[];
  currency: string;
  readonly?: boolean;
  errors?: PplErrorMap;
  maskedFields?: readonly string[];
}>();
/** 询价行 id → 这一行的取值 */
const values = defineModel<Record<string, PplRawValues>>('values', { default: () => ({}) });

const { t, locale } = useI18n();

const NUMERIC = ['int', 'decimal', 'money', 'percent'];
/** 可编辑列按控件定宽；只读列按类型，文本列以定义里的 width 为准但不超过 READ_MAX（长文本截断，悬停看全文） */
const EDIT_WIDTH: Record<string, number> = {
  money: 130,
  percent: 100,
  int: 100,
  decimal: 110,
  date: 150,
  bool: 80,
  enum: 140,
  multiEnum: 160,
  textarea: 180,
};
const READ_WIDTH: Record<string, number> = {
  money: 110,
  percent: 80,
  int: 70,
  decimal: 90,
  date: 100,
  bool: 60,
};
const READ_MAX = 160;

const keyColumns = computed(() => props.columns.filter((c) => c.keyField));
const rows = computed(() =>
  props.lines.map((line) => {
    const raw = values.value[line.id];
    return {
      line,
      display: props.readonly ? { ...raw, ...line.prefill } : liveRow(props.columns, line, raw),
      progress: requiredProgress(props.columns, raw),
      errorCount: Object.keys(props.errors?.[line.id] ?? {}).length,
    };
  }),
);

const drawerVisible = ref(false);
const drawerLineId = ref<string | null>(null);
const focusKey = ref<string | null>(null);
const drawerLine = computed(() => props.lines.find((l) => l.id === drawerLineId.value) ?? null);
const drawerValues = computed({
  get: () => (drawerLineId.value ? (values.value[drawerLineId.value] ?? {}) : {}),
  set: (row: PplRawValues) => {
    if (drawerLineId.value) values.value = { ...values.value, [drawerLineId.value]: row };
  },
});

function width(column: PplResolvedColumn): number {
  if (!props.readonly && column.source === 'supplier') return EDIT_WIDTH[column.type] ?? 140;
  return Math.min(column.width ?? READ_WIDTH[column.type] ?? 140, READ_MAX);
}

function update(lineId: string, key: string, value: unknown): void {
  const row = { ...values.value[lineId] };
  if (value === undefined || value === '') delete row[key];
  else row[key] = value;
  values.value = { ...values.value, [lineId]: row };
}

function open(lineId: string, key?: string): void {
  drawerLineId.value = lineId;
  focusKey.value = key ?? null;
  drawerVisible.value = true;
}

defineExpose({ open });
</script>

<template>
  <el-table
    :data="rows"
    row-key="line.id"
    border
    class="ppl-line-table"
    :empty-text="t('common.table.empty')"
  >
    <el-table-column
      v-for="column in keyColumns"
      :key="column.key"
      :min-width="width(column)"
      :align="NUMERIC.includes(column.type) ? 'right' : 'left'"
      :show-overflow-tooltip="readonly || column.source !== 'supplier'"
    >
      <template #header>
        <span v-if="!readonly && column.required" class="required">*</span>{{ pickLabel(column, locale) }}
      </template>
      <template #default="{ row }">
        <template v-if="!readonly && column.source === 'supplier'">
          <PplValueInput
            :model-value="values[row.line.id]?.[column.key]"
            :column="column"
            :currency="currency"
            :invalid="!!errors?.[row.line.id]?.[column.key]"
            @update:model-value="update(row.line.id, column.key, $event)"
          />
          <div v-if="errors?.[row.line.id]?.[column.key]" class="cell-error">
            {{ pplErrorText(errors[row.line.id][column.key]) }}
          </div>
        </template>
        <PplValueDisplay
          v-else
          :column="column"
          :value="row.display[column.key]"
          :masked="maskedFields?.includes(column.key)"
        />
      </template>
    </el-table-column>
    <el-table-column :label="t('common.table.actions')" width="130" fixed="right">
      <template #default="{ row }">
        <el-badge :value="row.errorCount" :hidden="row.errorCount === 0" type="danger" class="badge">
          <el-button link type="primary" @click="open(row.line.id)">
            {{ readonly ? t('ppl.table.viewAll') : t('ppl.table.editAll') }}
          </el-button>
        </el-badge>
        <!-- 必填项填写进度：不在列表里的必填列（如变体加的必填）在抽屉里填 -->
        <div v-if="!readonly" :class="['progress', { done: row.progress.filled === row.progress.total }]">
          <el-icon v-if="row.progress.filled === row.progress.total"><CircleCheck /></el-icon>
          {{ t('ppl.table.progress', row.progress) }}
        </div>
      </template>
    </el-table-column>
  </el-table>

  <PplForm
    v-model="drawerVisible"
    v-model:values="drawerValues"
    :groups="groups"
    :columns="columns"
    :line="drawerLine"
    :readonly="readonly"
    :currency="currency"
    :errors="drawerLineId ? errors?.[drawerLineId] : undefined"
    :masked-fields="maskedFields"
    :focus-key="focusKey"
  />
</template>

<style scoped>
.required {
  margin-right: 2px;
  color: var(--el-color-danger);
}
.cell-error {
  margin-top: 2px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.3;
  text-align: left;
}
.progress {
  display: flex;
  gap: 4px;
  align-items: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.progress.done {
  color: var(--el-color-success);
}
.badge {
  margin-top: 4px;
}
</style>
