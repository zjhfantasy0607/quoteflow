<script setup lang="ts">
import type { AuditLogDto } from '@quoteflow/shared';
import { useI18n } from 'vue-i18n';
import { auditActionLabel } from '@/utils/audit';
import { formatDateTime } from '@/utils/format';

/** 询价单的操作日志（R06-12）：表头、询价行、附件和状态动作，按时间正序 */
defineProps<{ items: AuditLogDto[]; loading?: boolean }>();

const { t } = useI18n();
</script>

<template>
  <el-table v-loading="loading" :data="items" :empty-text="t('inquiries.detail.noLogs')">
    <el-table-column :label="t('inquiries.detail.logFields.time')" width="170">
      <template #default="{ row }">{{ formatDateTime(row.createdAt, { seconds: true }) }}</template>
    </el-table-column>
    <el-table-column :label="t('inquiries.detail.logFields.actor')" width="140">
      <template #default="{ row }">{{ row.actor?.name ?? t('system.audit.systemActor') }}</template>
    </el-table-column>
    <el-table-column :label="t('inquiries.detail.logFields.action')" width="180">
      <template #default="{ row }">
        <span :title="row.action">{{ auditActionLabel(row.action) }}</span>
      </template>
    </el-table-column>
    <el-table-column
      prop="summary"
      :label="t('inquiries.detail.logFields.summary')"
      min-width="240"
      show-overflow-tooltip
    />
  </el-table>
</template>
