<script setup lang="ts">
import type { InquiryReportRowDto, ReportFilterOptionsDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import MaskedValue from '@/components/MaskedValue.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { downloadFile } from '@/utils/download';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import { emptyQuoteReportFilter, PUBLISHED_ROUND_STATUSES, quoteReportParams } from '@/utils/reports';
import QuoteReportFilters from './QuoteReportFilters.vue';

/**
 * 询报价单统计（M15 §4）：一行是一个已发布的轮次。金额经过后端密封（未开标显示 🔒"未开标，报价金额密封"）与
 * quote.amount 脱敏（🔒）；导出按当前筛选条件
 */
defineProps<{ options: ReportFilterOptionsDto }>();
const { t, locale } = useI18n();
const auth = useAuthStore();

const filter = ref(emptyQuoteReportFilter());
const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<InquiryReportRowDto[]>([]);
const total = ref(0);
const loading = ref(false);
const canExport = computed(() => auth.hasPerm('report:export'));
const canOpen = computed(() => auth.hasPerm('inquiry:view'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.inquiries({ ...quoteReportParams(filter.value), ...page });
    rows.value = res.items;
    total.value = res.total;
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
  void downloadFile(reportsApi.exportUrl('inquiries'), quoteReportParams(filter.value));
}

const TOTALS = ['minTotal', 'maxTotal', 'avgTotal'] as const;
const amountMasked = (row: InquiryReportRowDto, key: string) =>
  row.sealed || (row.maskedFields?.includes(key) ?? false);

onMounted(load);
</script>

<template>
  <div>
    <QuoteReportFilters
      v-model="filter"
      :options="options"
      :statuses="PUBLISHED_ROUND_STATUSES"
      @search="search"
      @reset="reset"
    />
    <div class="toolbar">
      <span class="count">{{ t('reports.resultCount', { total }) }}</span>
      <el-button v-if="canExport" icon="Download" @click="exportExcel">{{ t('reports.export') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="roundId">
      <el-table-column :label="t('reports.inquiries.fields.inquiryNo')" width="150" fixed="left">
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
      <el-table-column :label="t('reports.inquiries.fields.round')" width="72" align="center">
        <template #default="{ row }">{{ row.roundNo }}</template>
      </el-table-column>
      <el-table-column
        prop="inquiry.title"
        :label="t('reports.inquiries.fields.title')"
        min-width="200"
        show-overflow-tooltip
      />
      <el-table-column
        prop="inquiry.projectNo"
        :label="t('reports.inquiries.fields.projectNo')"
        width="130"
      />
      <el-table-column
        :label="t('reports.inquiries.fields.materialCategory')"
        width="130"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ pickName(row.materialCategory, locale) }}</template>
      </el-table-column>
      <el-table-column :label="t('reports.inquiries.fields.status')" width="170">
        <template #default="{ row }"><StatusTag enum-name="RoundStatus" :value="row.roundStatus" /></template>
      </el-table-column>
      <el-table-column
        prop="invitedCount"
        :label="t('reports.inquiries.fields.invited')"
        width="90"
        align="right"
      />
      <el-table-column :label="t('reports.inquiries.fields.quoted')" width="100" align="right">
        <template #header>
          <el-tooltip :content="t('reports.inquiries.quotedHint')" placement="top">
            <span>{{ t('reports.inquiries.fields.quoted') }}</span>
          </el-tooltip>
        </template>
        <template #default="{ row }">{{ row.quotedCount }}</template>
      </el-table-column>
      <el-table-column
        v-for="key in TOTALS"
        :key="key"
        :label="t(`reports.inquiries.fields.${key}`)"
        width="150"
        align="right"
      >
        <template #default="{ row }">
          <MaskedValue :masked="amountMasked(row, key)" :tip="row.sealed ? t('reports.sealed') : undefined">
            <span v-if="row[key] !== null" class="amount"
              >{{ row.currency }} {{ formatMoney(row[key], 2) }}</span
            >
            <span v-else class="empty">—</span>
          </MaskedValue>
        </template>
      </el-table-column>
      <el-table-column :label="t('reports.inquiries.fields.winner')" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <template v-if="row.winner">{{ row.winner.code }} {{ pickName(row.winner, locale) }}</template>
        </template>
      </el-table-column>
      <el-table-column prop="owner.name" :label="t('reports.inquiries.fields.owner')" width="100" />
      <el-table-column :label="t('reports.inquiries.fields.publishedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.publishedAt) }}</template>
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
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.count {
  color: var(--el-text-color-secondary);
}
.amount {
  font-variant-numeric: tabular-nums;
}
.empty {
  color: var(--el-text-color-placeholder);
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
