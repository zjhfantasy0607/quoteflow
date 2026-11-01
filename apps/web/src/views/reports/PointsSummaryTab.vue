<script setup lang="ts">
import { POINTS_RULE_CODES, type PointsSummaryRowDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import DictSelect from '@/components/DictSelect.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictStore } from '@/stores/dict';
import { downloadFile } from '@/utils/download';
import { formatDateTime, pickName } from '@/utils/format';
import { signedPoints } from '@/utils/reports';

/**
 * 供应商积分统计（M15 §4）：一行一家供应商，累计积分、区间内积分与按规则分项、最近变动时间；
 * 按区间内积分、累计积分从高到低。积分不按询价单的数据权限过滤
 */
const props = defineProps<{ refreshKey?: number }>();
const { t, locale } = useI18n();
const auth = useAuthStore();
const dict = useDictStore();

const query = reactive({ keyword: '', supplierCategoryCode: '', range: null as [string, string] | null });
const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<PointsSummaryRowDto[]>([]);
const total = ref(0);
const loading = ref(false);
const canExport = computed(() => auth.hasPerm('report:export'));
const canOpenSupplier = computed(() => auth.hasPerm('supplier:view'));

const params = () => ({
  keyword: query.keyword || undefined,
  supplierCategoryCode: query.supplierCategoryCode || undefined,
  from: query.range?.[0],
  to: query.range?.[1],
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.pointsSummary({ ...params(), ...page });
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
  Object.assign(query, { keyword: '', supplierCategoryCode: '', range: null });
  search();
}

function exportExcel(): void {
  void downloadFile(reportsApi.exportUrl('points-summary'), params());
}

const categoryName = (code: string) => {
  const item = dict.find('supplier_category', code);
  return item ? pickName(item, locale.value) : code;
};
const tone = (value: number) => (value > 0 ? 'positive' : value < 0 ? 'negative' : '');

watch(() => props.refreshKey, load);
onMounted(() => {
  void dict.load(['supplier_category']);
  void load();
});
</script>

<template>
  <div>
    <el-form inline @submit.prevent="search">
      <el-form-item>
        <el-input
          v-model="query.keyword"
          :placeholder="t('reports.filters.keyword')"
          prefix-icon="Search"
          clearable
          style="width: 200px"
        />
      </el-form-item>
      <el-form-item>
        <div style="width: 170px">
          <DictSelect
            v-model="query.supplierCategoryCode"
            type="supplier_category"
            :placeholder="t('reports.filters.supplierCategory')"
          />
        </div>
      </el-form-item>
      <el-form-item>
        <el-date-picker
          v-model="query.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          :start-placeholder="t('reports.filters.periodFrom')"
          :end-placeholder="t('reports.filters.periodTo')"
          style="width: 250px"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" icon="Search">{{
          t('common.actions.search')
        }}</el-button>
        <el-button icon="Refresh" @click="reset">{{ t('common.actions.reset') }}</el-button>
      </el-form-item>
    </el-form>
    <div class="toolbar">
      <span class="count">{{ t('reports.resultCount', { total }) }}</span>
      <el-button v-if="canExport" icon="Download" @click="exportExcel">{{ t('reports.export') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="supplier.id">
      <el-table-column
        :label="t('reports.pointsSummary.fields.supplier')"
        min-width="220"
        fixed="left"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <router-link
            v-if="canOpenSupplier"
            :to="{ name: 'supplier-detail', params: { id: row.supplier.id }, query: { tab: 'points' } }"
            class="link"
          >
            {{ row.supplier.code }} {{ pickName(row.supplier, locale) }}
          </router-link>
          <span v-else>{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('reports.pointsSummary.fields.category')" width="120">
        <template #default="{ row }">{{ categoryName(row.supplier.categoryCode) }}</template>
      </el-table-column>
      <el-table-column :label="t('reports.pointsSummary.fields.status')" width="80">
        <template #default="{ row }"
          ><StatusTag enum-name="EnableStatus" :value="row.supplier.status"
        /></template>
      </el-table-column>
      <el-table-column :label="t('reports.pointsSummary.fields.balance')" width="100" align="right">
        <template #default="{ row }">
          <b :class="tone(row.balance)">{{ row.balance }}</b>
        </template>
      </el-table-column>
      <el-table-column :label="t('reports.pointsSummary.fields.period')" width="110" align="right">
        <template #header>
          <el-tooltip :content="t('reports.pointsSummary.periodHint')" placement="top">
            <span>{{ t('reports.pointsSummary.fields.period') }}</span>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span :class="tone(row.periodPoints)">{{ row.periodPoints }}</span>
        </template>
      </el-table-column>
      <el-table-column
        v-for="rule in POINTS_RULE_CODES"
        :key="rule"
        :label="t(`enums.PointsRuleCode.${rule}`)"
        min-width="100"
        align="right"
      >
        <template #default="{ row }">
          <span :class="tone(row.byRule[rule])">{{
            row.byRule[rule] === 0 ? 0 : signedPoints(row.byRule[rule])
          }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('reports.pointsSummary.fields.lastChangedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.lastChangedAt) }}</template>
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
.positive {
  color: var(--el-color-success);
}
.negative {
  color: var(--el-color-danger);
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
