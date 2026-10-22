<script setup lang="ts">
import type { ApprovalAction, InquiryApprovalDto } from '@quoteflow/shared';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@/utils/format';

/** 审批记录时间线（R06-12）：提交、通过、驳回，带意见 */
defineProps<{ items: InquiryApprovalDto[] }>();

const { t } = useI18n();

const TYPE: Record<ApprovalAction, 'primary' | 'success' | 'danger'> = {
  SUBMIT: 'primary',
  APPROVE: 'success',
  REJECT: 'danger',
};
</script>

<template>
  <el-timeline v-if="items.length > 0" class="approval-timeline">
    <el-timeline-item
      v-for="item in items"
      :key="item.id"
      :type="TYPE[item.action]"
      :timestamp="`${formatDateTime(item.createdAt)} ${t('common.tz')}`"
      placement="top"
    >
      <div class="title">{{ t(`inquiries.timeline.${item.action}`, { name: item.actor.name }) }}</div>
      <div v-if="item.comment" class="comment">
        {{ t('inquiries.timeline.comment', { comment: item.comment }) }}
      </div>
    </el-timeline-item>
  </el-timeline>
  <el-empty v-else :description="t('inquiries.detail.noApprovals')" :image-size="64" />
</template>

<style scoped>
.title {
  font-weight: 500;
}
.comment {
  margin-top: 4px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}
</style>
