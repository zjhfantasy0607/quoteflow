<script setup lang="ts">
import type { FileDto, NegotiationMessageDto, NegotiationThreadDto } from '@quoteflow/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import { messageContent, proposalState, type ProposalState } from '@/utils/negotiation';
import FilePreview from './FilePreview.vue';
import MaskedValue from './MaskedValue.vue';

/**
 * 议价时间线（M11 R11-11，参考 PPT #30）：每条消息的议价轮次、方向、类型、提案表格（含税单价、数量、规格说明）、
 * 说明或原因、附件、时间和处理状态。采购方议价页签与门户议价区共用；没有 negotiation.amount 时价格显示 🔒
 */
const props = defineProps<{ thread: NegotiationThreadDto }>();

const { t, locale } = useI18n();
const previewing = ref<FileDto | null>(null);

/** 议价价格最多 4 位小数（R11-8），按 4 位显示，与报价里的含税单价一致 */
const PRICE_DECIMALS = 4;
const lineOf = computed(() => new Map(props.thread.lines.map((l) => [l.lineId, l])));
const time = (iso: string) => `${formatDateTime(iso)} ${t('common.tz')}`;
const state = (m: NegotiationMessageDto) => proposalState(props.thread, m);

const TYPE_TAG: Record<NegotiationMessageDto['type'], 'primary' | 'warning' | 'success' | 'danger' | 'info'> =
  {
    OFFER: 'primary',
    COUNTER: 'warning',
    ACCEPT: 'success',
    REJECT: 'danger',
    CLOSE: 'info',
  };
const STATE_TAG: Record<ProposalState, 'warning' | 'success' | 'danger' | 'info'> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  countered: 'info',
  reoffered: 'info',
  closed: 'info',
};
/** 拒绝、反提案的说明是原因，其余是方案说明 */
const contentLabel = (m: NegotiationMessageDto) =>
  m.type === 'REJECT' || m.type === 'COUNTER'
    ? t('negotiation.fields.reason')
    : t('negotiation.fields.content');
const masked = (m: NegotiationMessageDto) => m.maskedFields?.includes('unitPriceInclTax') ?? false;
</script>

<template>
  <div class="negotiation-timeline">
    <el-empty v-if="thread.messages.length === 0" :description="t('negotiation.empty')" :image-size="64" />
    <el-timeline v-else>
      <el-timeline-item
        v-for="m in thread.messages"
        :key="m.id"
        :timestamp="time(m.createdAt)"
        placement="top"
        :type="TYPE_TAG[m.type]"
      >
        <div class="head">
          <el-tag size="small" effect="plain" disable-transitions>
            {{ t('negotiation.round', { no: m.negotiationRound }) }}
          </el-tag>
          <span class="party">{{ t(`enums.NegotiationParty.${m.party}`) }}</span>
          <el-tag size="small" :type="TYPE_TAG[m.type]" disable-transitions>
            {{ t(`enums.NegotiationMsgType.${m.type}`) }}
          </el-tag>
          <span class="author">{{ m.author.name }}</span>
          <el-tag
            v-if="state(m)"
            size="small"
            effect="plain"
            :type="STATE_TAG[state(m)!]"
            disable-transitions
          >
            {{ t(`negotiation.state.${state(m)}`) }}
          </el-tag>
        </div>
        <el-table v-if="m.lines.length > 0" :data="m.lines" size="small" class="lines" row-key="lineId">
          <el-table-column prop="lineNo" :label="t('negotiation.fields.lineNo')" width="64" />
          <el-table-column :label="t('negotiation.fields.item')" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ pickName(lineOf.get(row.lineId), locale) || '—' }}</template>
          </el-table-column>
          <el-table-column :label="t('negotiation.fields.price')" width="170" align="right">
            <template #default="{ row }">
              <MaskedValue :masked="masked(m)">
                <span v-if="row.unitPriceInclTax !== null" class="num">
                  {{ thread.currency }} {{ formatMoney(row.unitPriceInclTax, PRICE_DECIMALS) }}
                </span>
                <span v-else class="muted">—</span>
              </MaskedValue>
            </template>
          </el-table-column>
          <el-table-column :label="t('negotiation.fields.newQuantity')" width="120" align="right">
            <template #default="{ row }">
              <span v-if="row.quantity" class="num">{{ row.quantity }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('negotiation.fields.specNote')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.specNote" class="pre">{{ row.specNote }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <p v-if="m.content" class="content">
          <span class="label">{{ t('negotiation.label', { label: contentLabel(m) }) }}</span>
          <span class="pre">{{ messageContent(m.content) }}</span>
        </p>
        <p v-if="m.resultVersionNo" class="result">
          {{ t('negotiation.resultVersion', { no: m.resultVersionNo }) }}
        </p>
        <div v-if="m.attachments.length > 0" class="files">
          <span class="label">{{
            t('negotiation.label', { label: t('negotiation.fields.attachments') })
          }}</span>
          <el-button v-for="f in m.attachments" :key="f.id" link type="primary" @click="previewing = f">
            {{ f.originalName }}
          </el-button>
        </div>
      </el-timeline-item>
    </el-timeline>

    <el-dialog
      :model-value="previewing !== null"
      :title="t('file.preview.title')"
      width="80%"
      top="5vh"
      append-to-body
      destroy-on-close
      @close="previewing = null"
    >
      <FilePreview v-if="previewing" :file="previewing" />
    </el-dialog>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.party {
  font-weight: 600;
}
.author {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.lines {
  margin-top: 8px;
}
.content,
.result {
  margin: 8px 0 0;
}
.result {
  color: var(--el-color-success);
}
.files {
  margin-top: 6px;
}
.label {
  color: var(--el-text-color-secondary);
}
.num {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--el-text-color-placeholder);
}
.pre {
  white-space: pre-wrap;
}
</style>
