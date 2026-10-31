<script setup lang="ts">
import type {
  RoundDiffChange,
  RoundDiffDto,
  RoundDiffField,
  RoundDiffLineDto,
  RoundDiffLineValues,
} from '@quoteflow/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDictStore } from '@/stores/dict';
import { pickName } from '@/utils/format';

/**
 * 规格对比表（M13 R13-6，参考 PPT #12）：每行一个询价行的变化——新增、删除、修改（字段的原值 → 新值、附件增删），
 * 默认只列有变化的行。采购方变更编辑页、询价详情的轮次查看与门户报价详情共用（门户的对比里没有备注）
 */
const props = defineProps<{ diff: RoundDiffDto }>();

const { t, locale } = useI18n();
const dict = useDictStore();
void dict.load(['unit']);

const showUnchanged = ref(false);
const rows = computed(() => props.diff.lines.filter((l) => showUnchanged.value || l.change !== 'UNCHANGED'));
const TAG: Record<RoundDiffChange, 'success' | 'danger' | 'warning' | 'info'> = {
  ADDED: 'success',
  REMOVED: 'danger',
  MODIFIED: 'warning',
  UNCHANGED: 'info',
};

function unitName(code: string): string {
  const item = dict.find('unit', code);
  return item ? pickName(item, locale.value) : code;
}

function fieldValue(field: RoundDiffField, line: RoundDiffLineValues | null): string {
  if (!line) return t('roundDiff.empty');
  if (field === 'unitCode') return unitName(line.unitCode);
  if (field === 'category') return pickName(line.category, locale.value);
  const value = line[field];
  return value === null || value === undefined || value === '' ? t('roundDiff.empty') : String(value);
}

function fieldChange(row: RoundDiffLineDto, field: RoundDiffField): string {
  return t('roundDiff.fieldChange', {
    field: t(`roundDiff.fields.${field}`),
    before: fieldValue(field, row.before),
    after: fieldValue(field, row.after),
  });
}

/** 行号：新增、删除的写一个，挪了位置的写"第 x 行 → 第 y 行" */
function lineLabel(row: RoundDiffLineDto): string {
  const from = row.before?.lineNo;
  const to = row.after?.lineNo;
  if (from !== undefined && to !== undefined && from !== to) return t('roundDiff.lineMove', { from, to });
  return t('roundDiff.lineNo', { no: to ?? from });
}

const itemOf = (row: RoundDiffLineDto): RoundDiffLineValues => (row.after ?? row.before)!;
const lineSummary = (line: RoundDiffLineValues) =>
  t('roundDiff.lineSummary', { spec: line.spec, quantity: line.quantity, unit: unitName(line.unitCode) });
</script>

<template>
  <div class="round-diff">
    <div class="toolbar">
      <span class="summary">
        {{
          t('roundDiff.summary', {
            added: diff.summary.ADDED,
            removed: diff.summary.REMOVED,
            modified: diff.summary.MODIFIED,
            unchanged: diff.summary.UNCHANGED,
          })
        }}
      </span>
      <el-switch v-model="showUnchanged" size="small" :active-text="t('roundDiff.showUnchanged')" />
    </div>
    <div v-if="diff.files.added.length || diff.files.removed.length" class="whole-files">
      <span class="label">{{ t('roundDiff.wholeFiles') }}</span>
      <span v-for="f in diff.files.added" :key="`a-${f.fileId}`" class="file added">
        {{ t('roundDiff.fileAdded', { name: f.originalName }) }}
      </span>
      <span v-for="f in diff.files.removed" :key="`r-${f.fileId}`" class="file removed">
        {{ t('roundDiff.fileRemoved', { name: f.originalName }) }}
      </span>
    </div>
    <el-table :data="rows" size="small" :empty-text="t('roundDiff.noChanges')">
      <el-table-column :label="t('roundDiff.columns.line')" width="150">
        <template #default="{ row }">{{ lineLabel(row) }}</template>
      </el-table-column>
      <el-table-column :label="t('roundDiff.columns.item')" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="itemOf(row).materialCode" class="code">{{ itemOf(row).materialCode }}</span>
          {{ pickName(itemOf(row), locale) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('roundDiff.columns.change')" width="96">
        <template #default="{ row }">
          <el-tag :type="TAG[row.change as RoundDiffChange]" size="small" disable-transitions>
            {{ t(`roundDiff.change.${row.change}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('roundDiff.columns.detail')" min-width="320">
        <template #default="{ row }">
          <div v-for="f in row.changedFields" :key="f" class="field">{{ fieldChange(row, f) }}</div>
          <div v-if="row.change === 'ADDED'" class="added">{{ lineSummary(itemOf(row)) }}</div>
          <div v-else-if="row.change === 'REMOVED'" class="removed">{{ lineSummary(itemOf(row)) }}</div>
          <div v-for="f in row.files.added" :key="`a-${f.fileId}`" class="file added">
            {{ t('roundDiff.fileAdded', { name: f.originalName }) }}
          </div>
          <div v-for="f in row.files.removed" :key="`r-${f.fileId}`" class="file removed">
            {{ t('roundDiff.fileRemoved', { name: f.originalName }) }}
          </div>
          <span v-if="row.change === 'UNCHANGED'" class="muted">—</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.summary,
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.whole-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-bottom: 8px;
  font-size: 13px;
}
.whole-files .label {
  font-weight: 600;
}
.code {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.field {
  white-space: pre-wrap;
}
.added {
  color: var(--el-color-success);
}
.removed {
  color: var(--el-color-danger);
  text-decoration: line-through;
}
.file.removed {
  text-decoration: none;
}
</style>
