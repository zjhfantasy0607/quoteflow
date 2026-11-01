<script setup lang="ts">
import type { PointsLedgerItemDto, ReportSupplierDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import PointsAdjustDialog from '@/components/PointsAdjustDialog.vue';
import PointsLedgerTable from '@/components/PointsLedgerTable.vue';
import { useAuthStore } from '@/stores/auth';

/** 供应商详情"积分"（R15-4）：累计积分 + 积分记录（按时间倒序）；有 points:adjust 的可以手工调整（R15-3） */
const props = defineProps<{ supplier: ReportSupplierDto }>();
const { t } = useI18n();
const auth = useAuthStore();

const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<PointsLedgerItemDto[]>([]);
const total = ref(0);
const balance = ref<number | null>(null);
const loading = ref(false);
const adjustVisible = ref(false);
const canAdjust = computed(() => auth.hasPerm('points:adjust'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.supplierPoints(props.supplier.id, page);
    rows.value = res.items;
    total.value = res.total;
    balance.value = res.balance;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  page.page = 1;
  void load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="balance">
        {{ t('suppliers.records.balance') }}
        <b :class="{ positive: (balance ?? 0) > 0, negative: (balance ?? 0) < 0 }">{{ balance ?? '' }}</b>
      </span>
      <el-button v-if="canAdjust" type="primary" icon="Edit" @click="adjustVisible = true">
        {{ t('reports.adjust.button') }}
      </el-button>
    </div>
    <PointsLedgerTable :rows="rows" :loading="loading" />
    <div class="pager">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
        @size-change="reload"
      />
    </div>
    <PointsAdjustDialog v-model="adjustVisible" :supplier="supplier" @adjusted="reload" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.balance {
  font-size: 14px;
}
.balance b {
  margin-left: 6px;
  font-size: 18px;
}
.positive {
  color: var(--el-color-success);
}
.negative {
  color: var(--el-color-danger);
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
