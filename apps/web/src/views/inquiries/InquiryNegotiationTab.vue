<script setup lang="ts">
import type { InquiryDetailDto, MatrixSupplierDto } from '@quoteflow/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import { pickName } from '@/utils/format';
import InquiryNegotiationPanel from './InquiryNegotiationPanel.vue';

/**
 * "议价"页签（M11 §5，有入围供应商时出现）：每家入围供应商一个子页签（轮到我方处理的带红点），
 * 内容是 InquiryNegotiationPanel。议价有变化时通知详情页刷新比价矩阵
 */
const props = defineProps<{ inquiry: InquiryDetailDto }>();
const emit = defineEmits<{ changed: [] }>();

const { t, locale } = useI18n();
const suppliers = ref<MatrixSupplierDto[]>([]);
const loading = ref(false);
const active = ref('');

const shortlisted = computed(() => suppliers.value.filter((s) => s.shortlisted));
/** 议价中、轮到我方（供应商拒绝或反提案后）才算待处理；成交后可以再议，但不提示 */
const awaitingUs = (s: MatrixSupplierDto) =>
  s.negotiation?.status === 'OPEN' && s.negotiation.awaiting === 'BUYER';

async function load(): Promise<void> {
  loading.value = true;
  try {
    const matrix = await inquiriesApi.matrix(props.inquiry.id, props.inquiry.currentRoundNo);
    suppliers.value = matrix.suppliers;
    if (!shortlisted.value.some((s) => s.quoteId === active.value))
      active.value = shortlisted.value[0]?.quoteId ?? '';
  } catch {
    suppliers.value = [];
  } finally {
    loading.value = false;
  }
}

async function onChanged(): Promise<void> {
  await load();
  emit('changed');
}

watch(() => [props.inquiry.id, props.inquiry.currentRound.shortlistCount], load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <el-empty
      v-if="!loading && shortlisted.length === 0"
      :description="t('inquiries.negotiation.noShortlist')"
    />
    <el-tabs v-else v-model="active" type="card">
      <el-tab-pane v-for="s in shortlisted" :key="s.quoteId" :name="s.quoteId" lazy>
        <template #label>
          <el-badge is-dot :hidden="!awaitingUs(s)" class="badge">
            <span class="code">{{ s.supplier.code }}</span> {{ pickName(s.supplier, locale) }}
          </el-badge>
        </template>
        <InquiryNegotiationPanel :quote-id="s.quoteId" @changed="onChanged" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.code {
  color: var(--el-text-color-secondary);
}
.badge :deep(.el-badge__content.is-dot) {
  top: 6px;
  right: -4px;
}
</style>
