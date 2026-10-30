<script setup lang="ts">
import type { InquiryDetailDto, QuoteResponseDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import DictTag from '@/components/DictTag.vue';
import StatusTag from '@/components/StatusTag.vue';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime, pickName } from '@/utils/format';
import ExtendDeadlineDialog from './ExtendDeadlineDialog.vue';

/**
 * "供应商响应"页签（M07 §5）：开标前只有响应状态和时间（05 §7.1 S-1），没有报价内容；
 * 勾选未响应（已邀请）的供应商催报（R07-8），延期（R07-10）。M10 补开标后的合计与报价详情
 */
const props = defineProps<{ inquiry: InquiryDetailDto }>();
const emit = defineEmits<{ changed: [InquiryDetailDto] }>();

const { t, locale } = useI18n();

const rows = ref<QuoteResponseDto[]>([]);
const loading = ref(false);
const picked = ref<QuoteResponseDto[]>([]);
const reminding = ref(false);
const extendVisible = ref(false);

const canRemind = computed(() => props.inquiry.allowedActions.includes('remind'));
const canExtend = computed(() => props.inquiry.allowedActions.includes('extendDeadline'));
const count = (status: QuoteResponseDto['status']) => rows.value.filter((r) => r.status === status).length;
const summary = computed(() =>
  t('inquiries.responses.summary', {
    total: rows.value.length,
    submitted: count('SUBMITTED'),
    declined: count('DECLINED'),
    pending: count('INVITED'),
  }),
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    rows.value = await inquiriesApi.responses(props.inquiry.id, props.inquiry.currentRoundNo);
    picked.value = [];
  } finally {
    loading.value = false;
  }
}

async function remind(): Promise<void> {
  const n = picked.value.length;
  if (!(await confirmAction(t('inquiries.responses.remindConfirm', { count: n }), { type: 'info' }))) return;
  reminding.value = true;
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
    reminding.value = false;
  }
}

// 动作接口返回新的详情（催报、延期、补充邀请……）时刷新
watch(() => props.inquiry, load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <el-alert
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
          :loading="reminding"
          @click="remind"
        >
          {{ t('inquiries.responses.remind', { count: picked.length }) }}
        </el-button>
        <el-button v-if="canExtend" icon="Clock" @click="extendVisible = true">
          {{ t('inquiries.responses.extend') }}
        </el-button>
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
        width="48"
        :selectable="(row: QuoteResponseDto) => row.status === 'INVITED'"
      />
      <el-table-column
        :label="t('inquiries.responses.fields.supplier')"
        min-width="200"
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
      <el-table-column :label="t('inquiries.responses.fields.status')" width="150">
        <template #default="{ row }">
          <StatusTag enum-name="QuoteStatus" :value="row.status" />
          <span v-if="row.status === 'INVITED' && row.firstViewedAt" class="viewed">
            {{ t('inquiries.responses.viewed') }}
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.invitedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.invitedAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.firstViewedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.firstViewedAt) || '—' }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.responses.fields.respondedAt')" width="150">
        <template #default="{ row }">{{ formatDateTime(row.respondedAt) || '—' }}</template>
      </el-table-column>
      <el-table-column
        prop="versionCount"
        :label="t('inquiries.responses.fields.versionCount')"
        width="90"
        align="right"
      />
      <el-table-column
        :label="t('inquiries.responses.fields.declineReason')"
        min-width="180"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.status === 'DECLINED'">
            <DictTag v-if="row.declineReasonCode" type="decline_reason" :code="row.declineReasonCode" plain />
            <span v-if="row.declineReason" class="reason">{{ row.declineReason }}</span>
          </template>
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
.reason {
  margin-left: 6px;
}
.tip {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
