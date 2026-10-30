<script setup lang="ts">
import type { InquiryDetailDto, InviteeSupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import { formatDateTime } from '@/utils/format';
import InviteeCandidatesTable from './InviteeCandidatesTable.vue';

/** 补充邀请（R07-7）：等待报价时追加供应商，新邀请的收到邀请邮件，截止时间不变 */
const props = defineProps<{ inquiry: InquiryDetailDto; invitedIds: string[] }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ invited: [InquiryDetailDto] }>();

const { t } = useI18n();
const selected = ref<InviteeSupplierDto[]>([]);
const saving = ref(false);

async function confirm(): Promise<void> {
  saving.value = true;
  try {
    const updated = await inquiriesApi.lateInvite(
      props.inquiry.id,
      props.inquiry.currentRoundNo,
      selected.value.map((s) => s.id),
    );
    ElMessage.success(t('inquiries.lateInvite.done', { count: selected.value.length }));
    visible.value = false;
    emit('invited', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (open) selected.value = [];
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('inquiries.lateInvite.title')"
    width="1000px"
    top="5vh"
    :close-on-click-modal="false"
    append-to-body
    destroy-on-close
  >
    <el-alert
      type="info"
      :title="
        t('inquiries.lateInvite.hint', {
          deadline: `${formatDateTime(inquiry.currentDeadline)} ${t('common.tz')}`,
        })
      "
      show-icon
      :closable="false"
      class="hint"
    />
    <InviteeCandidatesTable
      v-model="selected"
      :inquiry-id="inquiry.id"
      :default-material-category-id="inquiry.materialCategory.id"
      :locked-ids="invitedIds"
    />
    <template #footer>
      <span class="count">{{ t('inquiries.invitees.selectedCount', { count: selected.length }) }}</span>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="selected.length === 0" @click="confirm">
        {{ t('inquiries.lateInvite.confirm', { count: selected.length }) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-bottom: 12px;
}
.count {
  margin-right: 12px;
  color: var(--el-text-color-secondary);
}
</style>
