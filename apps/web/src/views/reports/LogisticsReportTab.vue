<script setup lang="ts">
import type { LogisticsReportRowDto, PplColumn, ReportFilterOptionsDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import PplValueDisplay from '@/components/PplValueDisplay.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictStore } from '@/stores/dict';
import { downloadFile } from '@/utils/download';
import { pickLabel, pickName } from '@/utils/format';
import { emptyQuoteReportFilter, OPENED_ROUND_STATUSES, quoteReportParams } from '@/utils/reports';
import QuoteReportFilters from './QuoteReportFilters.vue';

/**
 * 物流报价明细（M15 §4、A-09）：只有开过标的轮次（S-3），每家有效报价的当前版本一个询价行一行；
 * 列是 PPL 里 logistics: true 的列和量产交期，运费等金额列按 quote.amount 脱敏（🔒）
 */
defineProps<{ options: ReportFilterOptionsDto }>();
const { t, locale } = useI18n();
const auth = useAuthStore();
const dict = useDictStore();

const filter = ref(emptyQuoteReportFilter());
const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<LogisticsReportRowDto[]>([]);
const columns = ref<PplColumn[]>([]);
const total = ref(0);
const loading = ref(false);
const canExport = computed(() => auth.hasPerm('report:export'));
const canOpen = computed(() => auth.hasPerm('inquiry:view'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.logistics({ ...quoteReportParams(filter.value), ...page });
    rows.value = res.items;
    columns.value = res.columns;
    total.value = res.total;
    const types = [...new Set(res.columns.flatMap((c) => (c.dictType ? [c.dictType] : [])))];
    if (types.length > 0) void dict.load(types);
  } finally {
    loading.value = false;
  }
}

function search(): void {
  page.page = 1;
  void load();
}

function reset(): void {
  filter.value = emptyQuoteReportFilter();
  search();
}

function exportExcel(): void {
  void downloadFile(reportsApi.exportUrl('logistics'), quoteReportParams(filter.value));
}

const masked = (row: LogisticsReportRowDto, key: string) => row.maskedFields?.includes(key) ?? false;
const width = (c: PplColumn) => Math.max(c.width ?? 0, c.type === 'text' ? 130 : 110);

onMounted(load);
</script>

<template>
  <div>
    <QuoteReportFilters
      v-model="filter"
      :options="options"
      :statuses="OPENED_ROUND_STATUSES"
      @search="search"
      @reset="reset"
    />
    <el-alert :title="t('reports.logistics.note')" type="info" :closable="false" show-icon class="note" />
    <div class="toolbar">
      <span class="count">{{ t('reports.resultCount', { total }) }}</span>
      <el-button v-if="canExport" icon="Download" @click="exportExcel">{{ t('reports.export') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="id">
      <el-table-column :label="t('reports.logistics.fields.inquiryNo')" width="150" fixed="left">
        <template #default="{ row }">
          <router-link
            v-if="canOpen"
            :to="{ name: 'inquiry-detail', params: { id: row.inquiry.id } }"
            class="link"
          >
            {{ row.inquiry.formalNo }}
          </router-link>
          <span v-else>{{ row.inquiry.formalNo }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('reports.logistics.fields.round')" width="72" align="center" fixed="left">
        <template #default="{ row }">{{ row.roundNo }}</template>
      </el-table-column>
      <el-table-column
        :label="t('reports.logistics.fields.supplier')"
        width="180"
        fixed="left"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</template>
      </el-table-column>
      <el-table-column :label="t('reports.logistics.fields.version')" width="72" align="center">
        <template #default="{ row }">v{{ row.versionNo }}</template>
      </el-table-column>
      <el-table-column :label="t('reports.logistics.fields.line')" width="60" align="center">
        <template #default="{ row }">{{ row.lineNo }}</template>
      </el-table-column>
      <el-table-column :label="t('reports.logistics.fields.item')" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ pickName(row, locale) }}</span>
          <span class="spec">{{ row.spec }}</span>
        </template>
      </el-table-column>
      <el-table-column
        v-for="c in columns"
        :key="c.key"
        :label="pickLabel(c, locale)"
        :min-width="width(c)"
        :align="['int', 'decimal', 'money', 'percent'].includes(c.type) ? 'right' : 'left'"
      >
        <template #default="{ row }">
          <PplValueDisplay :column="c" :value="row.values[c.key]" :masked="masked(row, c.key)" />
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
        @size-change="search"
      />
    </div>
  </div>
</template>

<style scoped>
.note {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.count {
  color: var(--el-text-color-secondary);
}
.spec {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
