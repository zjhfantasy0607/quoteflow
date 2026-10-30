<script setup lang="ts">
import type { InquiryDetailDto, QuoteResponseDto, QuoteStatus } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import DictTag from '@/components/DictTag.vue';
import MaskedValue from '@/components/MaskedValue.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import ExtendDeadlineDialog from './ExtendDeadlineDialog.vue';

/**
 * "供应商响应"页签（M07 §5、M10 §5）：密封时（开标前）只有响应状态和时间，报价合计显示 🔒（05 §7.1 S-1，参考 PPT #23 补充）；
 * 开标后显示各家当前版本的合计，有 inquiry:evaluate 的可以点进报价详情。
 * 勾选未响应（已邀请）的供应商催报（R07-8）、延期（R07-10）、全部响应后提前截止（R10-2）
 */
const props = defineProps<{ inquiry: InquiryDetailDto }>();
const emit = defineEmits<{ changed: [InquiryDetailDto] }>();

const { t, locale } = useI18n();
const auth = useAuthStore();

const rows = ref<QuoteResponseDto[]>([]);
const sealed = ref(true);
const loading = ref(false);
const picked = ref<QuoteResponseDto[]>([]);
const acting = ref(false);
const extendVisible = ref(false);

const can = (action: InquiryDetailDto['allowedActions'][number]) => props.inquiry.allowedActions.includes(action);
const canRemind = computed(() => can('remind'));
const canExtend = computed(() => can('extendDeadline'));
const canCloseEarly = computed(() => can('closeEarly'));
const canViewQuote = computed(() => !sealed.value && auth.hasPerm('inquiry:evaluate'));
/** 已提交过报价的状态（开标后变为评标中、定标后中标 / 未中标） */
const SUBMITTED: readonly QuoteStatus[] = ['SUBMITTED', 'EVALUATING', 'WON', 'LOST'];
const count = (statuses: readonly QuoteStatus[]) => rows.value.filter((r) => statuses.includes(r.status)).length;
const pending = computed(() => count(['INVITED']));
const summary = computed(() =>
  t('inquiries.responses.summary', {
    total: rows.value.length,
    submitted: count(SUBMITTED),
    declined: count(['DECLINED']),
    pending: pending.value,
  }),
);
/** 截止后仍是"已邀请"的显示为"未响应"（05 §4） */
const noResponse = (row: QuoteResponseDto) =>
  row.status === 'INVITED' && props.inquiry.currentRoundStatus !== 'WAITING_QUOTES';

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await inquiriesApi.responses(props.inquiry.id, props.inquiry.currentRoundNo);
    rows.value = res.items;
    sealed.value = res.sealed;
    picked.value = [];
  } finally {
    loading.value = false;
  }
}

async function remind(): Promise<void> {
  const n = picked.value.length;
  if (!(await confirmAction(t('inquiries.responses.remindConfirm', { count: n }), { type: 'info' }))) return;
  acting.value = true;
  try {
    const updated = await inquiriesApi.remind(
      props.inquiry.id,
      props.inquiry.currentRoundNo,
      picked.value.map((r) => r.id),
    );
    ElMessage.success(t('inquiries.responses.reminded', { count: n }));
    emit('changed', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function closeEarly(): Promise<void> {
  if (!(await confirmAction(t('inquiries.responses.closeEarlyConfirm'), { type: 'warning' }))) return;
  acting.value = true;
  try {
    emit('changed', await inquiriesApi.closeEarly(props.inquiry.id, props.inquiry.currentRoundNo));
    ElMessage.success(t('inquiries.responses.closedEarly'));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

// 动作接口返回新的详情（催报、延期、补充邀请、开标……）时刷新
watch(() => props.inquiry, load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <el-alert
      v-if="sealed"
      type="info"
      :title="t('inquiries.responses.sealedHint')"
      show-icon
      :closable="false"
      class="hint"
    />
    <div class="toolbar">
      <span class="summary">{{ summary }}</span>
      <div>
        <el-button
          v-if="canRemind"
          type="primary"
          icon="Bell"
          :disabled="picked.length === 0"
          :loading="acting"
          @click="remind"
        >
          {{ t('inquiries.responses.remind', { count: picked.length }) }}
        </el-button>
        <el-button v-if="canExtend" icon="Clock" @click="extendVisible = true">
          {{ t('inquiries.responses.extend') }}
        </el-button>
        <el-tooltip
          v-if="canCloseEarly"
          :content="t('inquiries.responses.closeEarlyHint', { count: pending })"
          :disabled="pending === 0"
          placement="top"
        >
          <!-- 禁用的按钮不触发鼠标事件，包一层才能显示提示 -->
          <span class="wrap">
            <el-button icon="Finished" :disabled="pending > 0" :loading="acting" @click="closeEarly">
              {{ t('inquiries.responses.closeEarly') }}
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>
    <el-table
      :data="rows"
      :empty-text="t('common.table.empty')"
      row-key="id"
      @selection-change="(list: QuoteResponseDto[]) => (picked = list)"
    >
      <el-table-column
        v-if="canRemind"
        type="selection"
        width="44"
        fixed="left"
        :selectable="(row: QuoteResponseDto) => row.status === 'INVITED'"
      />
      <el-table-column
        :label="t('inquiries.responses.fields.supplier')"
        width="160"
        fixed="left"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span class="code">{{ row.supplier.code }}</span>
          {{ pickName(row.supplier, locale) }}
          <el-tooltip
            v-if="row.supplier.portalAccount !== 'ACTIVE'"
            :content="
              t('inquiries.responses.noAccount', {
                state: t(`enums.PortalAccountState.${row.supplier.portalAccount}`),
              })
            "
            placement="top"
          >
            <el-icon class="warn"><WarningFilled /></el-icon>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.status')" width="140">
        <template #default="{ row }">
          <el-tag v-if="noResponse(row)" type="info" effect="plain" disable-transitions>
            {{ t('inquiries.responses.noResponse') }}
          </el-tag>
          <StatusTag v-else enum-name="QuoteStatus" :value="row.status" />
          <span v-if="row.status === 'INVITED' && row.firstViewedAt" class="viewed">
            {{ t('inquiries.responses.viewed') }}
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.invitedAt')" width="125" class-name="dense">
        <template #default="{ row }">{{ formatDateTime(row.invitedAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.firstViewedAt')" width="125" class-name="dense">
        <template #default="{ row }">{{ formatDateTime(row.firstViewedAt) || '—' }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.respondedAt')" width="125" class-name="dense">
        <template #default="{ row }">{{ formatDateTime(row.respondedAt) || '—' }}</template>
      </el-table-column>
      <el-table-column
        prop="versionCount"
        :label="t('inquiries.responses.fields.versionCount')"
        width="84"
        align="right"
      />
      <el-table-column
        :label="t('inquiries.responses.fields.declineReason')"
        min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.status === 'DECLINED'">
            <DictTag v-if="row.declineReasonCode" type="decline_reason" :code="row.declineReasonCode" plain />
            <span v-if="row.declineReason" class="reason">{{ row.declineReason }}</span>
          </template>
        </template>
      </el-table-column>
      <!-- 合计和操作固定在右侧、供应商固定在左侧：窄屏横向滚动时也能看到 -->
      <el-table-column :label="t('inquiries.responses.fields.total')" width="140" align="right" fixed="right">
        <template #default="{ row }">
          <MaskedValue :masked="sealed || !!row.maskedFields?.includes('totalAmount')">
            <span v-if="row.totalAmount" class="amount">
              {{ row.currency }} {{ formatMoney(row.totalAmount, 2) }}
            </span>
            <span v-else>—</span>
          </MaskedValue>
        </template>
      </el-table-column>
      <el-table-column v-if="canViewQuote" :label="t('common.table.actions')" width="90" fixed="right">
        <template #default="{ row }">
          <router-link
            v-if="row.versionCount > 0"
            :to="{
              name: 'inquiry-quote',
              params: { id: inquiry.id, roundNo: inquiry.currentRoundNo, quoteId: row.id },
            }"
            class="view-link"
          >
            {{ t('inquiries.responses.viewQuote') }}
          </router-link>
        </template>
      </el-table-column>
    </el-table>
    <p v-if="canRemind" class="tip">{{ t('inquiries.responses.remindHint') }}</p>

    <ExtendDeadlineDialog
      v-model="extendVisible"
      :inquiry="inquiry"
      @extended="(updated) => emit('changed', updated)"
    />
  </div>
</template>

<style scoped>
.hint {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.toolbar .wrap {
  display: inline-block;
  margin-left: 12px;
}
.summary {
  color: var(--el-text-color-secondary);
}
.code {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.warn {
  margin-left: 4px;
  color: var(--el-color-warning);
  vertical-align: -2px;
}
.viewed {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.amount {
  font-variant-numeric: tabular-nums;
}
.reason {
  margin-left: 6px;
}
/* 时间列收窄内边距，1440 宽时整张表不出现横向滚动 */
:deep(.dense .cell) {
  padding: 0 8px;
}
.view-link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.tip {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
