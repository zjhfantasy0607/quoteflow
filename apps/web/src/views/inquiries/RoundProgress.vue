<script setup lang="ts">
import type { InquiryRoundSummaryDto } from '@quoteflow/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@/utils/format';

/**
 * 轮次进度条（M10 §5，参考 PPT #23）：等待报价 → 报价完成 → 开标 → 评标完成，当前步骤高亮，走过的步骤显示时间；
 * 还没到的"报价完成"显示计划的截止时间。取消、作废的轮次停在走到的那一步并标红。发布后才显示
 */
const props = defineProps<{ round: InquiryRoundSummaryDto }>();

const { t } = useI18n();

const STEPS = ['WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED', 'EVALUATED'] as const;

/** 走过的步数，按各步的时间判断（延期会清空报价完成时间，回到第 1 步） */
const reached = computed(() => {
  const r = props.round;
  if (r.evaluatedAt) return 4;
  if (r.openedAt) return 3;
  if (r.quotesClosedAt) return 2;
  return r.publishedAt ? 1 : 0;
});
const stopped = computed(() => props.round.status === 'CANCELLED' || props.round.status === 'SUPERSEDED');
/** el-steps 的 active：当前步骤的下标；评标完成时全部完成 */
const active = computed(() => (reached.value === STEPS.length ? STEPS.length : reached.value - 1));

const time = (iso: string | null) => `${formatDateTime(iso)} ${t('common.tz')}`;

const steps = computed(() => {
  const r = props.round;
  const times = [r.publishedAt, r.quotesClosedAt, r.openedAt, r.evaluatedAt];
  return STEPS.map((status, i) => {
    let when = '';
    let note = '';
    if (i < reached.value && times[i]) {
      when = time(times[i]);
      if (status === 'QUOTES_CLOSED' && r.closedEarly) note = t('inquiries.progress.closedEarly');
    } else if (status === 'QUOTES_CLOSED' && r.deadline && !stopped.value) {
      when = t('inquiries.progress.deadline', { time: time(r.deadline) });
    }
    return { status, title: t(`enums.RoundStatus.${status}`), when, note };
  });
});
</script>

<template>
  <div class="round-progress">
    <el-steps
      :active="active"
      finish-status="success"
      :process-status="stopped ? 'error' : 'process'"
      align-center
    >
      <el-step v-for="s in steps" :key="s.status" :title="s.title">
        <template #description>
          <div v-if="s.when">{{ s.when }}</div>
          <div v-if="s.note">{{ s.note }}</div>
        </template>
      </el-step>
    </el-steps>
    <div v-if="stopped" class="stopped">
      {{ t('inquiries.progress.stopped', { status: t(`enums.RoundStatus.${round.status}`) }) }}
    </div>
  </div>
</template>

<style scoped>
.round-progress {
  padding: 4px 0;
}
/* 居中模式下说明只占步骤宽度的 60%，时间会在"北京时间"中间折行；放宽到几乎整个步骤 */
.round-progress :deep(.el-step.is-center .el-step__description) {
  padding-right: 4%;
  padding-left: 4%;
}
.stopped {
  margin-top: 8px;
  color: var(--el-color-danger);
  font-size: 13px;
  text-align: center;
}
</style>
