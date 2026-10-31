<script setup lang="ts">
import type { InquiryDetailDto, InquiryInviteeDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import StatusTag from '@/components/StatusTag.vue';
import { pickName } from '@/utils/format';
import {
  DEADLINE_INPUT_FORMAT,
  deadlineInputToIso,
  deadlineShortcut,
  isBeforeAppToday,
  remainingText,
} from '@/utils/inquiries';

/**
 * 发布对话框（R07-3、R07-6）：截止时间按北京时间选择；确认受邀名单；没有可用门户账号的供应商只提示、不阻止发布。
 * 截止时间的最短提前量（inquiry.minDeadlineHours）由服务端校验。
 * M13：传 roundNo（变更草稿）时是"通知供应商重新报价"——发布第 N 轮，说明上一轮作废、谁收变更通知谁收邀请
 */
const props = defineProps<{ inquiry: InquiryDetailDto; roundNo?: number }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ published: [InquiryDetailDto] }>();

const { t, locale } = useI18n();

const deadline = ref('');
const invitees = ref<InquiryInviteeDto[]>([]);
const loading = ref(false);
const saving = ref(false);

const shortcuts = [3, 7, 14].map((days) => ({
  text: t('inquiries.publish.shortcut', { days }),
  value: () => deadlineShortcut(days),
}));
/** 默认时间 18:00（只决定选日期时带出的时分） */
const defaultTime = new Date(2000, 0, 1, 18, 0, 0);

const disabled = computed(() => invitees.value.filter((i) => i.supplier.status === 'DISABLED'));
const noAccount = computed(() => invitees.value.filter((i) => i.supplier.portalAccount !== 'ACTIVE'));
const names = (list: InquiryInviteeDto[]) =>
  list.map((i) => pickName(i.supplier, locale.value)).join(t('common.listSeparator'));
const left = computed(() => (deadline.value ? remainingText(deadlineInputToIso(deadline.value)) : null));
const canPublish = computed(() => invitees.value.length > 0 && disabled.value.length === 0);
const targetRoundNo = computed(() => props.roundNo ?? props.inquiry.currentRoundNo);
/** 发布的是变更草稿（第 N 轮） */
const isChange = computed(() => targetRoundNo.value !== props.inquiry.currentRoundNo);
const changeParams = computed(() => ({ no: targetRoundNo.value, current: props.inquiry.currentRoundNo }));

async function publish(): Promise<void> {
  if (!deadline.value) {
    ElMessage.warning(t('inquiries.publish.deadlineRequired'));
    return;
  }
  if (!left.value) {
    ElMessage.warning(t('inquiries.publish.deadlinePast'));
    return;
  }
  saving.value = true;
  try {
    const updated = await inquiriesApi.publish(
      props.inquiry.id,
      targetRoundNo.value,
      deadlineInputToIso(deadline.value),
    );
    ElMessage.success(
      isChange.value
        ? t('inquiries.publish.changeDone', { no: targetRoundNo.value, count: invitees.value.length })
        : t('inquiries.publish.done', { count: invitees.value.length }),
    );
    visible.value = false;
    emit('published', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, async (open) => {
  if (!open) return;
  deadline.value = '';
  loading.value = true;
  try {
    invitees.value = await inquiriesApi.invitees(props.inquiry.id);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isChange ? t('inquiries.publish.changeTitle', changeParams) : t('inquiries.publish.title')"
    width="680px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div v-loading="loading">
      <el-alert
        v-if="isChange"
        type="warning"
        :title="t('inquiries.publish.changeHint', changeParams)"
        show-icon
        :closable="false"
        class="change-hint"
      />
      <el-form label-position="top">
        <el-form-item :label="t('inquiries.publish.deadline')" required>
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

      <div class="section-title">
        {{
          isChange
            ? t('inquiries.publish.changeInvitees', { count: invitees.length })
            : t('inquiries.publish.invitees', { count: invitees.length })
        }}
      </div>
      <el-alert
        v-if="!loading && invitees.length === 0"
        type="error"
        :title="t('inquiries.publish.noInvitees')"
        show-icon
        :closable="false"
      />
      <template v-else>
        <el-table :data="invitees" max-height="240" size="small">
          <el-table-column :label="t('inquiries.invitees.fields.code')" width="130">
            <template #default="{ row }">{{ row.supplier.code }}</template>
          </el-table-column>
          <el-table-column :label="t('inquiries.invitees.fields.name')" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ pickName(row.supplier, locale) }}</template>
          </el-table-column>
          <el-table-column :label="t('inquiries.invitees.fields.portalAccount')" width="140">
            <template #default="{ row }">
              <StatusTag
                v-if="row.supplier.status === 'DISABLED'"
                enum-name="EnableStatus"
                :value="row.supplier.status"
              />
              <StatusTag v-else enum-name="PortalAccountState" :value="row.supplier.portalAccount" />
            </template>
          </el-table-column>
        </el-table>
        <el-alert
          v-if="disabled.length"
          type="error"
          :title="t('inquiries.publish.disabledInvitees', { names: names(disabled) })"
          show-icon
          :closable="false"
          class="alert"
        />
        <el-alert
          v-if="noAccount.length"
          type="warning"
          :title="t('inquiries.publish.noAccount')"
          show-icon
          :closable="false"
          class="alert"
        >
          <div class="accounts">
            <span v-for="i in noAccount" :key="i.supplier.id" class="account">
              {{
                t('inquiries.publish.accountState', {
                  name: pickName(i.supplier, locale),
                  state: t(`enums.PortalAccountState.${i.supplier.portalAccount}`),
                })
              }}
              <router-link
                :to="{ name: 'supplier-detail', params: { id: i.supplier.id } }"
                target="_blank"
                class="link"
              >
                {{ t('inquiries.publish.openAccount') }}
              </router-link>
            </span>
          </div>
        </el-alert>
      </template>
      <p class="frozen">{{ t('inquiries.publish.frozenHint') }}</p>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canPublish" @click="publish">
        {{ isChange ? t('inquiries.publish.changeConfirm') : t('inquiries.publish.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.left {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
}
.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.alert {
  margin-top: 10px;
}
.change-hint {
  margin-bottom: 12px;
}
.accounts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.link {
  margin-left: 6px;
  color: var(--el-color-primary);
}
.frozen {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
