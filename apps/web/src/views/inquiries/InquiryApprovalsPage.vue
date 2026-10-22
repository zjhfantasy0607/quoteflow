<script setup lang="ts">
import type { InquiryListItemDto } from '@quoteflow/shared';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { inquiriesApi } from '@/api/inquiries';
import PageHeader from '@/components/PageHeader.vue';
import { formatDateTime, pickName } from '@/utils/format';
import { inquiryNo } from '@/utils/inquiries';

/** 待我审批（M06 §5）：点进详情后在页面底部"审批操作"区通过或驳回 */
const { t, locale } = useI18n();
const router = useRouter();

const query = reactive({ page: 1, pageSize: 20 });
const rows = ref<InquiryListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await inquiriesApi.pending(query);
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function review(row: InquiryListItemDto): void {
  void router.push({ name: 'inquiry-detail', params: { id: row.id }, query: { from: 'approvals' } });
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('inquiries.approvals.title')" :subtitle="t('inquiries.approvals.subtitle')">
      <template #actions>
        <el-button icon="Refresh" @click="load">{{ t('common.actions.refresh') }}</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-table v-loading="loading" :data="rows" :empty-text="t('inquiries.approvals.empty')" row-key="id">
        <el-table-column :label="t('inquiries.fields.no')" min-width="170">
          <template #default="{ row }">
            <el-button link type="primary" @click="review(row)">{{ inquiryNo(row) }}</el-button>
          </template>
        </el-table-column>
        <el-table-column
          prop="projectNo"
          :label="t('inquiries.fields.projectNo')"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          prop="title"
          :label="t('inquiries.fields.title')"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('inquiries.fields.materialCategory')"
          min-width="130"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ pickName(row.materialCategory, locale) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.owner')" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.owner.name }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.submittedAt')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.table.actions')" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="review(row)">{{
              t('inquiries.approvals.review')
            }}</el-button>
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
          @size-change="load"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
