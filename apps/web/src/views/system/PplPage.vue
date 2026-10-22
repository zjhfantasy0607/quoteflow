<script setup lang="ts">
import {
  PPL_DECIMAL_TYPES,
  PPL_MASTER_CODE,
  resolveColumns,
  type PplResolvedColumn,
  type PplSetDto,
  type PplSetSummaryDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pplApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime, pickLabel, pickName } from '@/utils/format';
import PplUploadDialog from './PplUploadDialog.vue';

const FLAGS = ['sensitive', 'inMatrix', 'keyField', 'logistics'] as const;

const { t, locale } = useI18n();
const auth = useAuthStore();
const canManage = computed(() => auth.hasPerm('system:ppl:manage'));

const sets = ref<PplSetSummaryDto[]>([]);
const loading = ref(false);
const detail = ref<PplSetDto | null>(null);
const variantCode = ref<string>(PPL_MASTER_CODE);
const uploading = ref(false);

/** 当前查看的模板实际使用的列（与报价填报、Excel 用同一个 resolveColumns，R05-3） */
const columns = computed<PplResolvedColumn[]>(() =>
  detail.value ? resolveColumns(detail.value.definition, variantCode.value) : [],
);
const groupLabels = computed(
  () => new Map((detail.value?.definition.groups ?? []).map((g) => [g.key, pickLabel(g, locale.value)])),
);
const summary = computed(() => {
  const count = (pred: (c: PplResolvedColumn) => boolean) => columns.value.filter(pred).length;
  return {
    total: columns.value.length,
    prefill: count((c) => c.source === 'prefill'),
    supplier: count((c) => c.source === 'supplier'),
    required: count((c) => c.required),
    formula: count((c) => c.source === 'formula'),
  };
});

const rowClass = ({ row }: { row: PplSetSummaryDto }) =>
  row.version === detail.value?.version ? 'current' : '';
const variantLabel = (v: { code: string; nameZh: string; nameEn: string }) =>
  `${pickName(v, locale.value)} · ${v.code}`;

async function open(version: number): Promise<void> {
  detail.value = await pplApi.detail(version);
  if (!detail.value.variants.some((v) => v.code === variantCode.value)) variantCode.value = PPL_MASTER_CODE;
}

/** 刷新列表，并打开指定版本（默认保持当前查看的版本，没有时打开激活版本） */
async function load(version?: number): Promise<void> {
  loading.value = true;
  try {
    sets.value = await pplApi.list();
  } finally {
    loading.value = false;
  }
  const target =
    version ?? detail.value?.version ?? sets.value.find((s) => s.isActive)?.version ?? sets.value[0]?.version;
  if (target !== undefined) await open(target);
}

async function activate(set: PplSetSummaryDto): Promise<void> {
  if (!(await confirmAction(t('system.ppl.activateConfirm', { version: set.version }), { type: 'warning' })))
    return;
  try {
    await pplApi.activate(set.version);
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('system.ppl.activated', { version: set.version }));
  await load(set.version);
}

/** 下载当前版本的定义，改好后作为新版本上传（04 §9） */
function downloadJson(): void {
  if (!detail.value) return;
  const blob = new Blob([JSON.stringify(detail.value.definition, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ppl-v${detail.value.version}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 连续同组的行合并"分组"单元格 */
function spanGroup({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }) {
  if (columnIndex !== 0) return undefined;
  const rows = columns.value;
  const group = rows[rowIndex].group;
  if (rowIndex > 0 && rows[rowIndex - 1].group === group) return { rowspan: 0, colspan: 0 };
  let span = 1;
  while (rows[rowIndex + span]?.group === group) span += 1;
  return { rowspan: span, colspan: 1 };
}

function columnRule(c: PplResolvedColumn): string {
  const parts: string[] = [];
  if (c.prefillFrom)
    parts.push(t('system.ppl.rules.prefill', { source: t(`system.ppl.prefillSources.${c.prefillFrom}`) }));
  if (c.formula) parts.push(t('system.ppl.rules.formula', { name: c.formula }));
  if (PPL_DECIMAL_TYPES.includes(c.type) && c.precision !== undefined) {
    parts.push(t('system.ppl.rules.precision', { n: c.precision }));
  }
  if (c.min !== undefined && c.max !== undefined)
    parts.push(t('system.ppl.rules.range', { min: c.min, max: c.max }));
  else if (c.min !== undefined) parts.push(t('system.ppl.rules.min', { min: c.min }));
  else if (c.max !== undefined) parts.push(t('system.ppl.rules.max', { max: c.max }));
  if (c.maxLength !== undefined && c.source === 'supplier')
    parts.push(t('system.ppl.rules.maxLength', { n: c.maxLength }));
  if (c.dictType) parts.push(t('system.ppl.rules.dict', { type: c.dictType }));
  if (c.default !== undefined) parts.push(t('system.ppl.rules.default', { value: String(c.default) }));
  return parts.join(t('common.listSeparator'));
}

function onCreated(set: PplSetDto): void {
  void load(set.version);
}

onMounted(() => load());
</script>

<template>
  <div>
    <PageHeader :title="t('system.ppl.title')" :subtitle="t('system.ppl.subtitle')">
      <template #actions>
        <el-button v-if="canManage" type="primary" icon="Upload" @click="uploading = true">
          {{ t('system.ppl.upload') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <template #header>{{ t('system.ppl.versions') }}</template>
      <el-table
        v-loading="loading"
        class="sets-table"
        :data="sets"
        :empty-text="t('system.ppl.noData')"
        :row-class-name="rowClass"
        @row-click="(row: PplSetSummaryDto) => open(row.version)"
      >
        <el-table-column :label="t('system.ppl.fields.version')" width="90">
          <template #default="{ row }">{{ t('system.ppl.versionNo', { version: row.version }) }}</template>
        </el-table-column>
        <el-table-column
          prop="label"
          :label="t('system.ppl.fields.label')"
          min-width="240"
          show-overflow-tooltip
        />
        <el-table-column :label="t('system.ppl.fields.status')" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isActive" type="success" disable-transitions>{{
              t('system.ppl.active')
            }}</el-tag>
            <el-tag v-else type="info" disable-transitions>{{ t('system.ppl.inactive') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.fields.columns')" min-width="300">
          <template #default="{ row }">
            <span v-for="v in row.variants" :key="v.code" class="variant-count"
              >{{ v.code }} {{ v.columnCount }}</span
            >
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.fields.createdAt')" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.table.actions')" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="open(row.version)">{{
              t('common.actions.view')
            }}</el-button>
            <el-button v-if="canManage && !row.isActive" link type="primary" @click.stop="activate(row)">
              {{ t('system.ppl.activate') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="detail" shadow="never" class="qf-card detail">
      <template #header>
        <div class="detail-header">
          <span class="detail-title"
            >{{ t('system.ppl.versionNo', { version: detail.version }) }} {{ detail.label }}</span
          >
          <el-tag v-if="detail.isActive" type="success" disable-transitions>{{
            t('system.ppl.active')
          }}</el-tag>
          <div class="spacer" />
          <el-button icon="Download" @click="downloadJson">{{ t('system.ppl.downloadJson') }}</el-button>
        </div>
      </template>

      <div class="variant-bar">
        <span class="variant-label">{{ t('system.ppl.variant') }}</span>
        <el-radio-group v-model="variantCode" class="variants">
          <el-radio-button v-for="v in detail.variants" :key="v.code" :value="v.code">
            {{ t('system.ppl.variantOption', { name: variantLabel(v), count: v.columnCount }) }}
          </el-radio-button>
        </el-radio-group>
      </div>
      <p class="summary">{{ t('system.ppl.columnSummary', summary) }}</p>

      <el-table
        :data="columns"
        :span-method="spanGroup"
        border
        size="small"
        class="columns-table"
        row-key="key"
      >
        <el-table-column :label="t('system.ppl.columns.group')" width="120">
          <template #default="{ row }">{{ groupLabels.get(row.group) ?? row.group }}</template>
        </el-table-column>
        <el-table-column type="index" :label="t('system.ppl.columns.index')" width="50" />
        <el-table-column :label="t('system.ppl.columns.label')" min-width="180">
          <template #default="{ row }">
            <span class="column-label">{{ pickLabel(row, locale) }}</span>
            <div class="column-key">{{ row.key }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.columns.type')" width="100">
          <template #default="{ row }">{{ t(`system.ppl.types.${row.type}`) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.columns.source')" width="110">
          <template #default="{ row }">
            <el-tag :type="row.source === 'supplier' ? 'primary' : 'info'" size="small" disable-transitions>
              {{ t(`system.ppl.sources.${row.source}`) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.columns.required')" width="80" align="center">
          <template #default="{ row }">
            <el-icon v-if="row.required" class="required"><Select /></el-icon>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.columns.flags')" min-width="170">
          <template #default="{ row }">
            <template v-for="flag in FLAGS" :key="flag">
              <el-tag
                v-if="row[flag]"
                size="small"
                type="warning"
                effect="plain"
                class="flag"
                disable-transitions
              >
                {{ t(`system.ppl.flags.${flag}`) }}
              </el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.ppl.columns.rule')" min-width="220">
          <template #default="{ row }">{{ columnRule(row) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <PplUploadDialog v-model="uploading" @created="onCreated" />
  </div>
</template>

<style scoped>
.detail {
  margin-top: 16px;
}
.detail-header {
  display: flex;
  gap: 8px;
  align-items: center;
}
.detail-title {
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.variant-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.variant-label {
  color: var(--el-text-color-secondary);
}
.summary {
  margin: 12px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.variant-count + .variant-count::before {
  margin: 0 8px;
  color: var(--el-text-color-placeholder);
  content: '·';
}
.column-key {
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}
.required {
  color: var(--el-color-danger);
}
.flag {
  margin: 2px 4px 2px 0;
}
:deep(.sets-table .el-table__row) {
  cursor: pointer;
}
:deep(.sets-table .current) {
  --el-table-tr-bg-color: var(--el-color-primary-light-9);
}
</style>
