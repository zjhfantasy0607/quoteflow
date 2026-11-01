<script setup lang="ts">
import { REPORT_TYPES, type ReportFilterOptionsDto, type ReportType } from '@quoteflow/shared';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { reportsApi } from '@/api/reports';
import PageHeader from '@/components/PageHeader.vue';
import InquiryReportTab from './InquiryReportTab.vue';
import LogisticsReportTab from './LogisticsReportTab.vue';
import PointsLedgerTab from './PointsLedgerTab.vue';
import PointsSummaryTab from './PointsSummaryTab.vue';

/** 数据报表（M15 §4、§7，#26）：四个页签，?tab= 打开指定页签；筛选下拉（负责人、供应商）四个页签共用一份 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const TAB_KEYS: Record<ReportType, string> = {
  inquiries: 'inquiries',
  logistics: 'logistics',
  'points-summary': 'pointsSummary',
  'points-ledger': 'pointsLedger',
};
const isReportType = (value: unknown): value is ReportType =>
  typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);

const tab = ref<ReportType>(isReportType(route.query.tab) ? route.query.tab : 'inquiries');
const options = ref<ReportFilterOptionsDto>({ owners: [], suppliers: [] });
/** 手工调整后积分统计也要刷新 */
const pointsVersion = ref(0);

watch(tab, (value) => void router.replace({ query: { ...route.query, tab: value } }));

onMounted(async () => {
  options.value = await reportsApi.filterOptions().catch(() => options.value);
});
</script>

<template>
  <div>
    <PageHeader :title="t('reports.title')" :subtitle="t('reports.subtitle')" />
    <el-card shadow="never" class="qf-card">
      <el-tabs v-model="tab">
        <el-tab-pane
          v-for="type in REPORT_TYPES"
          :key="type"
          :name="type"
          :label="t(`reports.tabs.${TAB_KEYS[type]}`)"
          lazy
        >
          <InquiryReportTab v-if="type === 'inquiries'" :options="options" />
          <LogisticsReportTab v-else-if="type === 'logistics'" :options="options" />
          <PointsSummaryTab v-else-if="type === 'points-summary'" :refresh-key="pointsVersion" />
          <PointsLedgerTab v-else :options="options" @adjusted="pointsVersion += 1" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>
