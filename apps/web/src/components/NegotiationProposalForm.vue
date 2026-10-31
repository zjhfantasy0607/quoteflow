<script setup lang="ts">
import {
  NEGOTIATION_ATTACHMENTS_MAX,
  NEGOTIATION_CONTENT_MAX,
  NEGOTIATION_SPEC_NOTE_MAX,
  type FileDto,
  type NegotiationOfferParams,
  type NegotiationThreadDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatMoney, pickName } from '@/utils/format';
import { buildProposal, type ProposalRow } from '@/utils/negotiation';
import FileUploader from './FileUploader.vue';
import MaskedValue from './MaskedValue.vue';

/**
 * 目标价 / 反提案表单（M11 §5）：逐行填含税单价、数量、规格说明（参照当前版本的单价和数量），方案说明（反提案时是原因，
 * 必填），附件最多 10 个。提交前按 R11-8 预检，校验以服务端为准。disabled 时整张表只读（如等待供应商回复）
 */
const props = withDefaults(
  defineProps<{
    thread: NegotiationThreadDto;
    /** offer：采购方目标价；counter：供应商反提案（原因必填） */
    mode: 'offer' | 'counter';
    submitting?: boolean;
    disabled?: boolean;
  }>(),
  { submitting: false, disabled: false },
);
const emit = defineEmits<{ submit: [NegotiationOfferParams] }>();

const { t, locale } = useI18n();

const rows = ref<ProposalRow[]>([]);
const content = ref('');
const files = ref<FileDto[]>([]);
const reasonRequired = computed(() => props.mode === 'counter');
const priceMasked = computed(() => props.thread.maskedFields?.includes('currentUnitPrice') ?? false);
const lineNo = (lineId: string) => props.thread.lines.find((l) => l.lineId === lineId)?.lineNo ?? 0;

function reset(): void {
  rows.value = props.thread.lines.map((l) => ({ lineId: l.lineId, price: '', quantity: '', specNote: '' }));
  content.value = '';
  files.value = [];
}

function submit(): void {
  const res = buildProposal(rows.value, { reasonRequired: reasonRequired.value, content: content.value });
  if ('error' in res) {
    ElMessage.warning(t(`negotiation.form.${res.error}`, { no: res.lineId ? lineNo(res.lineId) : '' }));
    return;
  }
  emit('submit', {
    lines: res.lines,
    content: content.value.trim() || undefined,
    attachmentFileIds: files.value.map((f) => f.id),
  });
}

// 新消息到来（提交成功、对方回复）时清空表单
watch(() => props.thread.messages.length, reset, { immediate: true });
</script>

<template>
  <div class="proposal-form">
    <p class="hint">{{ t('negotiation.form.hint') }}</p>
    <el-table :data="thread.lines" row-key="lineId" size="small">
      <el-table-column prop="lineNo" :label="t('negotiation.fields.lineNo')" width="64" />
      <el-table-column :label="t('negotiation.fields.item')" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          {{ pickName(row, locale) }}
          <div class="spec">{{ row.spec }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="t('negotiation.fields.currentPrice')" width="150" align="right">
        <template #default="{ row }">
          <MaskedValue :masked="priceMasked">
            <span v-if="row.currentUnitPrice" class="num"
              >{{ thread.currency }} {{ formatMoney(row.currentUnitPrice) }}</span
            >
            <span v-else class="muted">—</span>
          </MaskedValue>
        </template>
      </el-table-column>
      <el-table-column :label="t('negotiation.fields.currentQuantity')" width="110" align="right">
        <template #default="{ row }">
          <span class="num">{{ row.currentQuantity }}</span>
          <span class="unit">{{ pickName({ nameZh: row.unitNameZh, nameEn: row.unitNameEn }, locale) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('negotiation.fields.price')" width="150">
        <template #default="{ $index }">
          <el-input
            v-model="rows[$index].price"
            :placeholder="t('negotiation.form.pricePlaceholder')"
            :disabled="disabled"
            maxlength="20"
            class="price-input"
          />
        </template>
      </el-table-column>
      <el-table-column :label="t('negotiation.fields.newQuantity')" width="130">
        <template #default="{ $index }">
          <el-input
            v-model="rows[$index].quantity"
            :placeholder="t('negotiation.form.quantityPlaceholder')"
            :disabled="disabled"
            maxlength="20"
            class="quantity-input"
          />
        </template>
      </el-table-column>
      <el-table-column :label="t('negotiation.fields.specNote')" min-width="200">
        <template #default="{ $index }">
          <el-input
            v-model="rows[$index].specNote"
            :placeholder="t('negotiation.form.specNotePlaceholder')"
            :disabled="disabled"
            :maxlength="NEGOTIATION_SPEC_NOTE_MAX"
            class="spec-input"
          />
        </template>
      </el-table-column>
    </el-table>
    <el-form label-position="top" class="extra" @submit.prevent>
      <el-form-item
        :label="reasonRequired ? t('negotiation.fields.reason') : t('negotiation.fields.content')"
        :required="reasonRequired"
      >
        <el-input
          v-model="content"
          type="textarea"
          :rows="3"
          :maxlength="NEGOTIATION_CONTENT_MAX"
          show-word-limit
          :disabled="disabled"
          :placeholder="
            reasonRequired
              ? t('negotiation.form.reasonPlaceholder')
              : t('negotiation.form.contentPlaceholder')
          "
          class="content-input"
        />
      </el-form-item>
      <el-form-item :label="t('negotiation.fields.attachments')">
        <FileUploader
          v-model="files"
          kind="ATTACHMENT"
          :limit="NEGOTIATION_ATTACHMENTS_MAX"
          :disabled="disabled"
        />
      </el-form-item>
    </el-form>
    <div class="actions">
      <slot name="actions" />
      <el-button type="primary" icon="Promotion" :loading="submitting" :disabled="disabled" @click="submit">
        {{ t('negotiation.form.submit') }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.spec {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.num {
  font-variant-numeric: tabular-nums;
}
.unit {
  margin-left: 4px;
  color: var(--el-text-color-secondary);
}
.muted {
  color: var(--el-text-color-placeholder);
}
.extra {
  margin-top: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
