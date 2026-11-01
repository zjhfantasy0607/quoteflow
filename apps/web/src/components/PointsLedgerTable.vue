<script setup lang="ts">
import type { PointsLedgerItemDto } from '@quoteflow/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, pickName } from '@/utils/format';
import { signedPoints } from '@/utils/reports';

/** 积分记录表（M15）：报表"积分记录流水"与供应商详情"积分"页签共用；自动积分的操作人显示"系统" */
defineProps<{ rows: PointsLedgerItemDto[]; loading?: boolean; showSupplier?: boolean }>();
const { t, locale } = useI18n();
const auth = useAuthStore();
const canOpenInquiry = computed(() => auth.hasPerm('inquiry:view'));
</script>

<template>
  <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="id">
    <el-table-column :label="t('reports.pointsLedger.fields.time')" width="150">
      <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
    </el-table-column>
    <el-table-column
      v-if="showSupplier"
      :label="t('reports.pointsLedger.fields.supplier')"
      min-width="200"
      show-overflow-tooltip
    >
      <template #default="{ row }">{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</template>
    </el-table-column>
    <el-table-column :label="t('reports.pointsLedger.fields.rule')" width="120">
      <template #default="{ row }">{{ t(`enums.PointsRuleCode.${row.ruleCode}`) }}</template>
    </el-table-column>
    <el-table-column :label="t('reports.pointsLedger.fields.delta')" width="80" align="right">
      <template #default="{ row }">
        <b :class="row.delta > 0 ? 'positive' : 'negative'">{{ signedPoints(row.delta) }}</b>
      </template>
    </el-table-column>
    <el-table-column :label="t('reports.pointsLedger.fields.source')" width="90">
      <template #default="{ row }">
        <el-tag :type="row.source === 'MANUAL' ? 'warning' : 'info'" disable-transitions>
          {{ t(`enums.PointsSource.${row.source}`) }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="t('reports.pointsLedger.fields.inquiryNo')" width="160">
      <template #default="{ row }">
        <template v-if="row.inquiry">
          <router-link
            v-if="canOpenInquiry"
            :to="{ name: 'inquiry-detail', params: { id: row.inquiry.id } }"
            class="link"
          >
            {{ row.inquiry.formalNo }}
          </router-link>
          <span v-else>{{ row.inquiry.formalNo }}</span>
        </template>
      </template>
    </el-table-column>
    <el-table-column :label="t('reports.pointsLedger.fields.round')" width="72" align="center">
      <template #default="{ row }">{{ row.roundNo ?? '' }}</template>
    </el-table-column>
    <el-table-column
      prop="remark"
      :label="t('reports.pointsLedger.fields.remark')"
      min-width="200"
      show-overflow-tooltip
    />
    <el-table-column :label="t('reports.pointsLedger.fields.operator')" width="100">
      <template #default="{ row }">{{ row.createdBy?.name ?? t('reports.pointsLedger.system') }}</template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
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
</style>
