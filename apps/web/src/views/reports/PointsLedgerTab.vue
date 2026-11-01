<script setup lang="ts">
import {
  POINTS_RULE_CODES,
  type PointsLedgerItemDto,
  type PointsRuleCode,
  type ReportFilterOptionsDto,
} from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import PointsAdjustDialog from '@/components/PointsAdjustDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { downloadFile } from '@/utils/download';
import { pickName } from '@/utils/format';
import PointsLedgerTable from '@/components/PointsLedgerTable.vue';

/** 积分记录流水（M15 §4）：供应商、规则、时间区间筛选，按时间倒序；有 points:adjust 的可以手工调整（R15-3） */
defineProps<{ options: ReportFilterOptionsDto }>();
const emit = defineEmits<{ adjusted: [] }>();
const { t, locale } = useI18n();
const auth = useAuthStore();

const query = reactive({
  supplierId: '',
  ruleCode: '' as PointsRuleCode | '',
  range: null as [string, string] | null,
});
const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<PointsLedgerItemDto[]>([]);
const total = ref(0);
const loading = ref(false);
const adjustVisible = ref(false);
const canExport = computed(() => auth.hasPerm('report:export'));
const canAdjust = computed(() => auth.hasPerm('points:adjust'));

const params = () => ({
  supplierId: query.supplierId || undefined,
  ruleCode: query.ruleCode || undefined,
  from: query.range?.[0],
  to: query.range?.[1],
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.pointsLedger({ ...params(), ...page });
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
  Object.assign(query, { supplierId: '', ruleCode: '', range: null });
  search();
}

function exportExcel(): void {
  void downloadFile(reportsApi.exportUrl('points-ledger'), params());
}

function adjusted(): void {
  search();
  emit('adjusted');
}

onMounted(load);
</script>

<template>
  <div>
    <el-form inline @submit.prevent="search">
      <el-form-item>
        <el-select
          v-model="query.supplierId"
          filterable
          clearable
          :placeholder="t('reports.filters.supplier')"
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
        <el-select
          v-model="query.ruleCode"
          clearable
          :placeholder="t('reports.filters.rule')"
          style="width: 140px"
        >
          <el-option
            v-for="rule in POINTS_RULE_CODES"
            :key="rule"
            :value="rule"
            :label="t(`enums.PointsRuleCode.${rule}`)"
          />
        </el-select>
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
      <span>
        <el-button v-if="canAdjust" type="primary" icon="Edit" @click="adjustVisible = true">
          {{ t('reports.adjust.button') }}
        </el-button>
        <el-button v-if="canExport" icon="Download" @click="exportExcel">{{ t('reports.export') }}</el-button>
      </span>
    </div>
    <PointsLedgerTable :rows="rows" :loading="loading" show-supplier />
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
    <PointsAdjustDialog v-model="adjustVisible" :suppliers="options.suppliers" @adjusted="adjusted" />
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
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
