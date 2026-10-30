<script setup lang="ts">
import type { FileAccessLogDto, InquiryDetailDto } from '@quoteflow/shared';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import { formatDateTime, pickName } from '@/utils/format';

/** "下载日志"页签（R08-4）：供应商和内部用户在线预览、下载规格书与产品图的记录，新的在前 */
const props = defineProps<{ inquiry: InquiryDetailDto }>();

const { t, locale } = useI18n();
const rows = ref<FileAccessLogDto[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 20 });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await inquiriesApi.accessLogs(props.inquiry.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.inquiry,
  () => {
    query.page = 1;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <p class="hint">{{ t('inquiries.accessLogs.hint') }}</p>
    <el-table v-loading="loading" :data="rows" :empty-text="t('inquiries.accessLogs.empty')">
      <el-table-column :label="t('inquiries.accessLogs.fields.time')" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt, { seconds: true }) }}</template>
      </el-table-column>
      <el-table-column
        :label="t('inquiries.accessLogs.fields.supplier')"
        min-width="200"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.supplier">
            <span class="code">{{ row.supplier.code }}</span>
            {{ pickName(row.supplier, locale) }}
          </template>
          <span v-else class="muted">{{ t('inquiries.accessLogs.internal') }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.accessLogs.fields.user')" width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.user?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.accessLogs.fields.file')" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ row.file.originalName }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.accessLogs.fields.action')" width="110">
        <template #default="{ row }">{{ t(`enums.FileAccessAction.${row.action}`) }}</template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
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
.code {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.muted {
  color: var(--el-text-color-secondary);
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
