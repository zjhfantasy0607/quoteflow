<script setup lang="ts">
import type { InquiryDetailDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import { formatDateTime } from '@/utils/format';
import {
  DEADLINE_INPUT_FORMAT,
  deadlineInputToIso,
  extendedDeadline,
  isBeforeAppToday,
  remainingText,
} from '@/utils/inquiries';

/**
 * 延期（R07-10）：新截止要晚于原截止（和现在 + 最短提前量，服务端校验）；报价完成的轮次延期后回到等待报价。
 * 受邀且没有拒绝的供应商会收到邮件
 */
const props = defineProps<{ inquiry: InquiryDetailDto }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ extended: [InquiryDetailDto] }>();

const { t } = useI18n();
const deadline = ref('');
const saving = ref(false);

const current = computed(() => props.inquiry.currentDeadline);
const left = computed(() => (deadline.value ? remainingText(deadlineInputToIso(deadline.value)) : null));
const defaultTime = new Date(2000, 0, 1, 18, 0, 0);
/** 在原截止时间上顺延 N 天 */
const shortcuts = computed(() =>
  current.value
    ? [1, 3, 7].map((days) => ({
        text: t('inquiries.extend.shortcut', { days }),
        value: () => extendedDeadline(current.value!, days),
      }))
    : [],
);

async function confirm(): Promise<void> {
  if (!deadline.value) {
    ElMessage.warning(t('inquiries.publish.deadlineRequired'));
    return;
  }
  const iso = deadlineInputToIso(deadline.value);
  if (current.value && new Date(iso).getTime() <= new Date(current.value).getTime()) {
    ElMessage.warning(t('inquiries.extend.notLater'));
    return;
  }
  saving.value = true;
  try {
    const updated = await inquiriesApi.extendDeadline(props.inquiry.id, props.inquiry.currentRoundNo, iso);
    ElMessage.success(t('inquiries.extend.done', { time: `${formatDateTime(iso)} ${t('common.tz')}` }));
    visible.value = false;
    emit('extended', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (open) deadline.value = '';
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('inquiries.extend.title')"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form label-position="top">
      <el-form-item :label="t('inquiries.extend.current')">
        {{ current ? `${formatDateTime(current)} ${t('common.tz')}` : '—' }}
      </el-form-item>
      <el-form-item :label="t('inquiries.extend.next')" required>
        <el-date-picker
          v-model="deadline"
          type="datetime"
          :format="DEADLINE_INPUT_FORMAT"
          :value-format="DEADLINE_INPUT_FORMAT"
          :placeholder="t('inquiries.publish.deadlinePlaceholder')"
          :shortcuts="shortcuts"
          :default-time="defaultTime"
          :disabled-date="(d: Date) => isBeforeAppToday(d)"
          style="width: 260px"
        />
        <span v-if="left" class="left">{{ t('inquiries.publish.deadlineLeft', { left }) }}</span>
      </el-form-item>
    </el-form>
    <p class="hint">{{ t('inquiries.extend.hint') }}</p>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">{{
        t('inquiries.extend.confirm')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.left {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
}
.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
