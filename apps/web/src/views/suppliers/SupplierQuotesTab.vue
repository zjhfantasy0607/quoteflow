<script setup lang="ts">
import type { SupplierQuoteItemDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/api/reports';
import MaskedValue from '@/components/MaskedValue.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatMoney } from '@/utils/format';

/**
 * 供应商详情"报价记录"（R15-4）：该供应商参与过的报价单（只有当前用户数据权限内的询价单），按邀请时间倒序；
 * 金额未开标时密封、没有 quote.amount 时脱敏。截止后仍是"已邀请"的显示"未响应"
 */
const props = defineProps<{ supplierId: string }>();
const { t } = useI18n();
const auth = useAuthStore();

const page = reactive({ page: 1, pageSize: 20 });
const rows = ref<SupplierQuoteItemDto[]>([]);
const total = ref(0);
const loading = ref(false);
const canOpenInquiry = computed(() => auth.hasPerm('inquiry:view'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await reportsApi.supplierQuotes(props.supplierId, page);
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  page.page = 1;
  void load();
}

const noResponse = (row: SupplierQuoteItemDto) =>
  row.status === 'INVITED' && row.roundStatus !== 'WAITING_QUOTES';
const amountMasked = (row: SupplierQuoteItemDto) =>
  row.sealed || (row.maskedFields?.includes('totalAmount') ?? false);

onMounted(load);
</script>

<template>
  <div>
    <p class="hint">{{ t('suppliers.records.quotesHint') }}</p>
    <el-table v-loading="loading" :data="rows" :empty-text="t('suppliers.records.quotesEmpty')" row-key="id">
      <el-table-column :label="t('suppliers.records.fields.inquiry')" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <router-link
            v-if="canOpenInquiry"
            :to="{ name: 'inquiry-detail', params: { id: row.inquiry.id } }"
            class="link"
          >
            {{ row.inquiry.formalNo }}
          </router-link>
          <span v-else>{{ row.inquiry.formalNo }}</span>
          <span class="title">{{ row.inquiry.title }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('suppliers.records.fields.round')" width="70" align="center">
        <template #default="{ row }">{{ row.roundNo }}</template>
      </el-table-column>
      <el-table-column :label="t('suppliers.records.fields.status')" width="110">
        <template #default="{ row }">
          <el-tag v-if="noResponse(row)" type="info" effect="plain" disable-transitions>
            {{ t('suppliers.records.noResponse') }}
          </el-tag>
          <StatusTag v-else enum-name="QuoteStatus" :value="row.status" />
        </template>
      </el-table-column>
      <el-table-column :label="t('suppliers.records.fields.invitedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.invitedAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('suppliers.records.fields.submittedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.lastSubmittedAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('suppliers.records.fields.total')" width="170" align="right">
        <template #default="{ row }">
          <MaskedValue :masked="amountMasked(row)" :tip="row.sealed ? t('reports.sealed') : undefined">
            <span v-if="row.totalAmount !== null" class="amount">
              {{ row.currency }} {{ formatMoney(row.totalAmount, 2) }}
            </span>
          </MaskedValue>
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
        @size-change="reload"
      />
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.title {
  margin-left: 8px;
}
.amount {
  font-variant-numeric: tabular-nums;
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
