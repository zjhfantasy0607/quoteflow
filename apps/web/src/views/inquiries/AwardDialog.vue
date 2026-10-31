<script setup lang="ts">
import type { InquiryDetailDto, MatrixSupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import MaskedValue from '@/components/MaskedValue.vue';
import { confirmAction } from '@/utils/dialogs';
import { formatMoney, pickName } from '@/utils/format';

/**
 * 定标对话框（M12 §5，参考 PPT #10）：评标中的供应商单选（名称、含税合计、是否入围；入围的排在前面）+ 定标说明，
 * 提示其他供应商将被标记为未中标、定标后自动生成合同草稿。定标不能撤销，提交前再确认一次
 */
const props = defineProps<{ inquiry: InquiryDetailDto; suppliers: MatrixSupplierDto[] }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ awarded: [InquiryDetailDto] }>();

const { t, locale } = useI18n();

const quoteId = ref('');
const comment = ref('');
const saving = ref(false);

/** R12-1：只有评标中的报价能中标；sort 是稳定的，入围的在前、其余保持汇总表的顺序 */
const candidates = computed(() =>
  props.suppliers
    .filter((s) => s.status === 'EVALUATING')
    .sort((a, b) => Number(b.shortlisted) - Number(a.shortlisted)),
);
const picked = computed(() => candidates.value.find((s) => s.quoteId === quoteId.value) ?? null);
const supplierName = (s: MatrixSupplierDto) => `${s.supplier.code} ${pickName(s.supplier, locale.value)}`;

async function submit(): Promise<void> {
  const winner = picked.value;
  if (!winner) {
    ElMessage.warning(t('inquiries.award.pickRequired'));
    return;
  }
  const name = supplierName(winner);
  if (!(await confirmAction(t('inquiries.award.confirmMessage', { supplier: name })))) return;
  saving.value = true;
  try {
    const updated = await inquiriesApi.award(props.inquiry.id, props.inquiry.currentRoundNo, {
      quoteId: winner.quoteId,
      comment: comment.value.trim() || undefined,
    });
    ElMessage.success(t('inquiries.award.done', { supplier: name }));
    visible.value = false;
    emit('awarded', updated);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (!open) return;
  quoteId.value = candidates.value.length === 1 ? candidates.value[0].quoteId : '';
  comment.value = '';
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('inquiries.award.title')"
    width="640px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-alert type="warning" :title="t('inquiries.award.hint')" show-icon :closable="false" class="alert" />
    <el-empty
      v-if="candidates.length === 0"
      :description="t('inquiries.award.noCandidates')"
      :image-size="64"
    />
    <template v-else>
      <div class="section-title">{{ t('inquiries.award.supplier') }}</div>
      <el-table
        :data="candidates"
        size="small"
        row-key="quoteId"
        class="candidates"
        @row-click="(row: MatrixSupplierDto) => (quoteId = row.quoteId)"
      >
        <el-table-column width="48" align="center">
          <template #default="{ row }">
            <el-radio v-model="quoteId" :value="row.quoteId" :aria-label="supplierName(row)">&nbsp;</el-radio>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.award.fields.supplier')" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="code">{{ row.supplier.code }}</span>
            {{ pickName(row.supplier, locale) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.award.fields.total')" width="170" align="right">
          <template #default="{ row }">
            <MaskedValue :masked="!!row.maskedFields?.includes('totalAmount')">
              <span class="amount">{{ row.currency }} {{ formatMoney(row.totalAmount, 2) }}</span>
            </MaskedValue>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.award.fields.shortlisted')" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.shortlisted" type="success" size="small" disable-transitions>
              {{ t('inquiries.award.shortlisted') }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-form label-position="top" class="form">
        <el-form-item :label="t('inquiries.award.comment')">
          <el-input
            v-model="comment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :placeholder="t('inquiries.award.commentPlaceholder')"
          />
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="candidates.length === 0" @click="submit">
        {{ t('inquiries.award.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.alert {
  margin-bottom: 16px;
}
.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.candidates :deep(.el-table__row) {
  cursor: pointer;
}
.code {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}
.amount {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--el-text-color-placeholder);
}
.form {
  margin-top: 16px;
}
</style>
