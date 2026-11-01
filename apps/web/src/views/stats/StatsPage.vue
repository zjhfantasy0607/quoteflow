<script setup lang="ts">
import type {
  ReportFilterOptionsDto,
  StatsCycleTimeDto,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsWinRateDto,
} from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi, statsApi } from '@/api/reports';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictSelect from '@/components/DictSelect.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictStore } from '@/stores/dict';
import { downloadFile } from '@/utils/download';
import { VChart } from '@/utils/echarts';
import { pickName } from '@/utils/format';
import {
  currentAppMonth,
  currentAppYear,
  cycleTimeOption,
  formatOneDecimal,
  formatPercent,
  monthLabel,
  projectsOption,
  responseSpeedOption,
  formatShare,
  winRateOption,
} from '@/utils/stats';

/**
 * 统计看板（M15 §3、§7，#13–17）：顶部筛选（日期区间、材料分类、供应商分类、供应商）+ 查询、重置、导出；
 * 2×2 四张图，每张图下可展开对应的数据表。年询盘项目数按年度统计，年度在那张图的右上角选
 */
const { t, locale } = useI18n();
const auth = useAuthStore();
const dict = useDictStore();

type Filters = {
  range: [string, string] | null;
  materialCategoryId: string;
  supplierCategoryCode: string;
  supplierId: string;
};

const thisYear = currentAppYear();
const defaults = (): Filters => ({
  range: [`${thisYear}-01-01`, `${thisYear}-12-31`],
  materialCategoryId: '',
  supplierCategoryCode: '',
  supplierId: '',
});
const filters = reactive<Filters>(defaults());
/** 点"查询"时的筛选；导出用它，保证和图一致 */
const applied = ref<Filters>(defaults());
const year = ref(String(thisYear));
const options = ref<ReportFilterOptionsDto>({ owners: [], suppliers: [] });

const projects = ref<StatsProjectsDto | null>(null);
const response = ref<StatsResponseSpeedDto | null>(null);
const winRate = ref<StatsWinRateDto | null>(null);
const cycle = ref<StatsCycleTimeDto | null>(null);
const loading = reactive({ projects: false, response: false, winRate: false, cycle: false });

const canExport = computed(() => auth.hasPerm('report:export'));
const opt = (value: string) => value || undefined;
const range = (f: Filters) => ({ from: f.range?.[0], to: f.range?.[1] });

async function track<T>(
  key: keyof typeof loading,
  run: () => Promise<T>,
  set: (value: T) => void,
): Promise<void> {
  loading[key] = true;
  try {
    set(await run());
  } finally {
    loading[key] = false;
  }
}

function loadProjects(): Promise<void> {
  return track(
    'projects',
    () =>
      statsApi.projects({
        year: Number(year.value),
        materialCategoryId: opt(applied.value.materialCategoryId),
      }),
    (data) => (projects.value = data),
  );
}

async function load(): Promise<void> {
  const f = applied.value;
  await Promise.all([
    loadProjects(),
    track(
      'response',
      () =>
        statsApi.responseSpeed({
          ...range(f),
          supplierCategoryCode: opt(f.supplierCategoryCode),
          materialCategoryId: opt(f.materialCategoryId),
        }),
      (data) => (response.value = data),
    ),
    track(
      'winRate',
      () =>
        statsApi.winRate({
          ...range(f),
          supplierId: opt(f.supplierId),
          supplierCategoryCode: opt(f.supplierCategoryCode),
        }),
      (data) => (winRate.value = data),
    ),
    track(
      'cycle',
      () => statsApi.cycleTime({ ...range(f), materialCategoryId: opt(f.materialCategoryId) }),
      (data) => (cycle.value = data),
    ),
  ]);
}

function search(): void {
  applied.value = { ...filters, range: filters.range ? [...filters.range] : null };
  void load();
}

function reset(): void {
  Object.assign(filters, defaults());
  search();
}

function exportExcel(): void {
  const f = applied.value;
  void downloadFile(statsApi.exportUrl, {
    year: Number(year.value),
    ...range(f),
    materialCategoryId: opt(f.materialCategoryId),
    supplierCategoryCode: opt(f.supplierCategoryCode),
    supplierId: opt(f.supplierId),
  });
}

const tr = (key: string, named?: Record<string, unknown>) => t(key, named ?? {});
// t() 读的是响应式的语言：切换语言后图表文字跟着变
const projectsChart = computed(() =>
  projects.value ? projectsOption(projects.value, tr, currentAppMonth()) : null,
);
const responseChart = computed(() => (response.value ? responseSpeedOption(response.value, tr) : null));
const winRateChart = computed(() => (winRate.value ? winRateOption(winRate.value, tr) : null));
const cycleChart = computed(() => (cycle.value ? cycleTimeOption(cycle.value, tr) : null));

const empty = {
  projects: computed(() => !projects.value?.total.inquiryCount),
  response: computed(() => !response.value?.total),
  winRate: computed(() => !winRate.value?.total.participantCount && !winRate.value?.total.winCount),
  cycle: computed(() => !cycle.value?.total),
};

/** 区间跨年时月份写成 2026-01 */
const winRateCrossYear = computed(() => {
  const months = winRate.value?.months ?? [];
  return months.length > 0 && months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);
});
const supplierCategoryName = (code: string) => {
  const item = dict.find('supplier_category', code);
  return item ? pickName(item, locale.value) : code;
};

onMounted(() => {
  void dict.load(['supplier_category']);
  void reportsApi
    .filterOptions()
    .then((data) => (options.value = data))
    .catch(() => undefined);
  void load();
});
</script>

<template>
  <div class="stats-page">
    <PageHeader :title="t('stats.title')" :subtitle="t('stats.subtitle')">
      <template #actions>
        <el-button v-if="canExport" icon="Download" @click="exportExcel">{{ t('stats.export') }}</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card filters">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-date-picker
            v-model="filters.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('stats.filters.rangeFrom')"
            :end-placeholder="t('stats.filters.rangeTo')"
            style="width: 250px"
          />
        </el-form-item>
        <el-form-item>
          <CategoryTreeSelect
            v-model="filters.materialCategoryId"
            allow-disabled
            :placeholder="t('stats.filters.materialCategory')"
            style="width: 190px"
          />
        </el-form-item>
        <el-form-item>
          <div style="width: 170px">
            <DictSelect
              v-model="filters.supplierCategoryCode"
              type="supplier_category"
              :placeholder="t('stats.filters.supplierCategory')"
            />
          </div>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.supplierId"
            filterable
            clearable
            :placeholder="t('stats.filters.supplier')"
            style="width: 220px"
          >
            <el-option
              v-for="s in options.suppliers"
              :key="s.id"
              :value="s.id"
              :label="`${s.code} ${pickName(s, locale)}`"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{
            t('common.actions.search')
          }}</el-button>
          <el-button icon="Refresh" @click="reset">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="charts">
      <!-- 年询盘项目数与品类 -->
      <el-card v-loading="loading.projects" shadow="never" class="qf-card chart-card" data-chart="projects">
        <template #header>
          <div class="card-header">
            <span class="card-title">
              {{ t('stats.projects.title') }}
              <el-tooltip :content="t('stats.projects.help')" placement="top" popper-class="stats-help">
                <el-icon class="help"><InfoFilled /></el-icon>
              </el-tooltip>
            </span>
            <el-date-picker
              v-model="year"
              type="year"
              value-format="YYYY"
              :clearable="false"
              :placeholder="t('stats.filters.year')"
              style="width: 110px"
              @change="loadProjects"
            />
          </div>
        </template>
        <div class="chart">
          <el-empty
            v-if="projects && empty.projects.value"
            :description="t('stats.noData')"
            :image-size="72"
          />
          <VChart v-else-if="projectsChart" :option="projectsChart" autoresize />
        </div>
        <el-collapse v-if="projects">
          <el-collapse-item :title="t('stats.dataTable')" name="table">
            <el-table
              :data="projects.months"
              size="small"
              :empty-text="t('common.table.empty')"
              max-height="320"
            >
              <el-table-column :label="t('stats.month')">
                <template #default="{ row }">{{ monthLabel(row.month, tr) }}</template>
              </el-table-column>
              <el-table-column prop="inquiryCount" :label="t('stats.projects.inquiryCount')" align="right" />
              <el-table-column prop="projectCount" :label="t('stats.projects.projectCount')" align="right" />
              <el-table-column
                prop="categoryCount"
                :label="t('stats.projects.categoryCount')"
                align="right"
              />
            </el-table>
            <div class="table-total">
              {{
                t('stats.projects.totalLine', {
                  inquiries: projects.total.inquiryCount,
                  projects: projects.total.projectCount,
                  categories: projects.total.categoryCount,
                })
              }}
            </div>
            <div class="table-hint">{{ t('stats.projects.categoryHint') }}</div>
            <el-table :data="projects.categories" size="small" :empty-text="t('common.table.empty')">
              <el-table-column :label="t('stats.projects.category')">
                <template #default="{ row }"
                  >{{ row.category.code }} {{ pickName(row.category, locale) }}</template
                >
              </el-table-column>
              <el-table-column prop="inquiryCount" :label="t('stats.projects.inquiryCount')" align="right" />
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <!-- 供应商响应速度 -->
      <el-card v-loading="loading.response" shadow="never" class="qf-card chart-card" data-chart="response">
        <template #header>
          <span class="card-title">
            {{ t('stats.response.title') }}
            <el-tooltip :content="t('stats.response.help')" placement="top" popper-class="stats-help">
              <el-icon class="help"><InfoFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <div class="chart">
          <el-empty
            v-if="response && empty.response.value"
            :description="t('stats.noData')"
            :image-size="72"
          />
          <VChart v-else-if="responseChart" :option="responseChart" autoresize />
        </div>
        <el-collapse v-if="response">
          <el-collapse-item :title="t('stats.dataTable')" name="table">
            <el-table :data="response.buckets" size="small">
              <el-table-column :label="t('stats.response.bucket')">
                <template #default="{ row }">{{ t(`stats.response.buckets.${row.bucket}`) }}</template>
              </el-table-column>
              <el-table-column prop="count" :label="t('stats.response.count')" align="right" />
              <el-table-column :label="t('stats.share')" align="right">
                <template #default="{ row }">{{ formatShare(row.count, response.total) }}</template>
              </el-table-column>
            </el-table>
            <el-table
              :data="response.suppliers"
              size="small"
              class="supplier-table"
              :empty-text="t('common.table.empty')"
              max-height="320"
            >
              <el-table-column :label="t('stats.supplier')" min-width="130" show-overflow-tooltip>
                <template #default="{ row }"
                  >{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</template
                >
              </el-table-column>
              <el-table-column :label="t('stats.supplierCategory')" width="90" show-overflow-tooltip>
                <template #default="{ row }">{{ supplierCategoryName(row.supplier.categoryCode) }}</template>
              </el-table-column>
              <el-table-column
                prop="invitedCount"
                :label="t('stats.response.invited')"
                width="64"
                align="right"
              />
              <el-table-column
                prop="respondedCount"
                :label="t('stats.response.responded')"
                width="64"
                align="right"
              />
              <el-table-column :label="t('stats.response.rate')" width="76" align="right">
                <template #default="{ row }">{{ formatPercent(row.responseRate) }}</template>
              </el-table-column>
              <el-table-column :label="t('stats.response.avgHours')" align="right" width="92">
                <template #default="{ row }">{{ formatOneDecimal(row.avgResponseHours) }}</template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <!-- 中选次数与成功率 -->
      <el-card v-loading="loading.winRate" shadow="never" class="qf-card chart-card" data-chart="win-rate">
        <template #header>
          <span class="card-title">
            {{ t('stats.winRate.title') }}
            <el-tooltip :content="t('stats.winRate.help')" placement="top" popper-class="stats-help">
              <el-icon class="help"><InfoFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <div class="chart">
          <el-empty v-if="winRate && empty.winRate.value" :description="t('stats.noData')" :image-size="72" />
          <VChart v-else-if="winRateChart" :option="winRateChart" autoresize />
        </div>
        <el-collapse v-if="winRate">
          <el-collapse-item :title="t('stats.dataTable')" name="table">
            <el-table :data="winRate.months" size="small" max-height="320">
              <el-table-column :label="t('stats.month')">
                <template #default="{ row }">{{ monthLabel(row.month, tr, winRateCrossYear) }}</template>
              </el-table-column>
              <el-table-column prop="winCount" :label="t('stats.winRate.winCount')" align="right" />
              <el-table-column
                prop="participantCount"
                :label="t('stats.winRate.participantCount')"
                align="right"
              />
              <el-table-column :label="t('stats.winRate.successRate')" align="right">
                <template #default="{ row }">{{ formatPercent(row.successRate) }}</template>
              </el-table-column>
            </el-table>
            <div class="table-total">
              {{
                t('stats.winRate.totalLine', {
                  wins: winRate.total.winCount,
                  participants: winRate.total.participantCount,
                  rate: formatPercent(winRate.total.successRate),
                })
              }}
            </div>
            <el-table
              :data="winRate.suppliers"
              size="small"
              class="supplier-table"
              :empty-text="t('common.table.empty')"
              max-height="320"
            >
              <el-table-column :label="t('stats.supplier')" min-width="130" show-overflow-tooltip>
                <template #default="{ row }"
                  >{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</template
                >
              </el-table-column>
              <el-table-column :label="t('stats.supplierCategory')" width="90" show-overflow-tooltip>
                <template #default="{ row }">{{ supplierCategoryName(row.supplier.categoryCode) }}</template>
              </el-table-column>
              <el-table-column
                prop="invitedCount"
                :label="t('stats.winRate.invited')"
                width="64"
                align="right"
              />
              <el-table-column
                prop="quotedCount"
                :label="t('stats.winRate.quoted')"
                width="64"
                align="right"
              />
              <el-table-column prop="wonCount" :label="t('stats.winRate.won')" width="64" align="right" />
              <el-table-column :label="t('stats.winRate.winRate')" width="76" align="right">
                <template #default="{ row }">{{ formatPercent(row.winRate) }}</template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <!-- 询盘周期时效 -->
      <el-card v-loading="loading.cycle" shadow="never" class="qf-card chart-card" data-chart="cycle">
        <template #header>
          <div class="card-header">
            <span class="card-title">
              {{ t('stats.cycle.title') }}
              <el-tooltip :content="t('stats.cycle.help')" placement="top" popper-class="stats-help">
                <el-icon class="help"><InfoFilled /></el-icon>
              </el-tooltip>
            </span>
            <span v-if="cycle && cycle.total > 0" class="card-extra">
              {{ t('stats.cycle.average', { days: formatOneDecimal(cycle.avgDays), count: cycle.total }) }}
            </span>
          </div>
        </template>
        <div class="chart">
          <el-empty v-if="cycle && empty.cycle.value" :description="t('stats.noData')" :image-size="72" />
          <VChart v-else-if="cycleChart" :option="cycleChart" autoresize />
        </div>
        <el-collapse v-if="cycle">
          <el-collapse-item :title="t('stats.dataTable')" name="table">
            <el-table :data="cycle.buckets" size="small">
              <el-table-column :label="t('stats.cycle.bucket')">
                <template #default="{ row }">{{ t(`stats.cycle.buckets.${row.bucket}`) }}</template>
              </el-table-column>
              <el-table-column prop="count" :label="t('stats.cycle.count')" align="right" />
              <el-table-column :label="t('stats.share')" align="right">
                <template #default="{ row }">{{ formatShare(row.count, cycle.total) }}</template>
              </el-table-column>
            </el-table>
            <el-table :data="cycle.months" size="small" class="supplier-table" max-height="320">
              <el-table-column :label="t('stats.month')">
                <template #default="{ row }">{{ row.month }}</template>
              </el-table-column>
              <el-table-column prop="count" :label="t('stats.cycle.completed')" align="right" />
              <el-table-column :label="t('stats.cycle.avgDays')" align="right">
                <template #default="{ row }">{{ formatOneDecimal(row.avgDays) }}</template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </div>

    <div class="note">{{ t('stats.note') }}</div>
  </div>
</template>

<style scoped>
.filters :deep(.el-form-item) {
  margin-right: 12px;
  margin-bottom: 0;
}
.charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 16px;
  margin-top: 16px;
}
/* 网格里的卡片不要全局的 .qf-card + .qf-card 上边距，否则同一行的两张图上下错开 */
.charts > .chart-card {
  margin: 0;
}
.card-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-weight: 600;
}
.card-extra {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.help {
  color: var(--el-text-color-placeholder);
  cursor: help;
}
.chart {
  height: 300px;
}
.chart :deep(.el-empty) {
  height: 100%;
}
.table-total,
.table-hint {
  margin: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.supplier-table {
  margin-top: 12px;
}
.note {
  margin-top: 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>

<style>
.stats-help {
  max-width: 420px;
  line-height: 1.6;
}
</style>
