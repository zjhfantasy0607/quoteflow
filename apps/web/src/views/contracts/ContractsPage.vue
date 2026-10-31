<script setup lang="ts">
import { ContractStatus, type ContractListItemDto } from '@quoteflow/shared';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { contractsApi } from '@/api/contracts';
import MaskedValue from '@/components/MaskedValue.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';

/** 合同列表（M14 §5）：状态页签 + 关键字、生成日期筛选；数据权限跟随询价单（后端过滤），金额按 contract.amount 脱敏 */
const { t, locale } = useI18n();
const router = useRouter();

const STATUSES = Object.values(ContractStatus);
const tab = ref<'all' | ContractStatus>('all');
const query = reactive({
  keyword: '',
  range: null as [string, string] | null,
  page: 1,
  pageSize: 20,
});
const rows = ref<ContractListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await contractsApi.list({
      status: tab.value === 'all' ? undefined : tab.value,
      keyword: query.keyword || undefined,
      from: query.range?.[0],
      to: query.range?.[1],
      page: query.page,
      pageSize: query.pageSize,
    });
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search(): void {
  query.page = 1;
  void load();
}

function resetQuery(): void {
  Object.assign(query, { keyword: '', range: null, page: 1 });
  void load();
}

function open(row: ContractListItemDto): void {
  void router.push({ name: 'contract-detail', params: { id: row.id } });
}

const amountMasked = (row: ContractListItemDto) => row.maskedFields?.includes('amount') ?? false;

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('contracts.list.title')" :subtitle="t('contracts.list.subtitle')" />

    <el-card shadow="never" class="qf-card">
      <el-tabs v-model="tab" @tab-change="search">
        <el-tab-pane name="all" :label="t('contracts.list.tabs.all')" />
        <el-tab-pane
          v-for="name in STATUSES"
          :key="name"
          :name="name"
          :label="t(`contracts.list.tabs.${name}`)"
        />
      </el-tabs>

      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input
            v-model="query.keyword"
            :placeholder="t('contracts.list.keywordPlaceholder')"
            prefix-icon="Search"
            clearable
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-date-picker
            v-model="query.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('contracts.list.dateFrom')"
            :end-placeholder="t('contracts.list.dateTo')"
            style="width: 250px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{
            t('common.actions.search')
          }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="id">
        <el-table-column :label="t('contracts.fields.contractNo')" min-width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ row.contractNo }}</el-button>
          </template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.inquiryNo')" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.inquiry.formalNo }} · {{ row.inquiry.title }}</template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.supplier')" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.supplier.code }} {{ pickName(row.supplier, locale) }}</template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.amount')" min-width="140" align="right">
          <template #default="{ row }">
            <MaskedValue :masked="amountMasked(row)">
              <span class="amount">{{ row.currency }} {{ formatMoney(row.amount, 2) }}</span>
            </MaskedValue>
          </template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.status')" width="100">
          <template #default="{ row }"><StatusTag enum-name="ContractStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.deliveryDate')" width="110">
          <template #default="{ row }">{{ row.deliveryDate ?? '' }}</template>
        </el-table-column>
        <el-table-column :label="t('contracts.fields.createdAt')" width="150">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.table.actions')" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ t('common.actions.view') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.amount {
  font-variant-numeric: tabular-nums;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
