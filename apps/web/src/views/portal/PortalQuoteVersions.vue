<script setup lang="ts">
import type { Locale, PortalQuoteDetailDto, QuoteVersionSummaryDto } from '@quoteflow/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import QuoteVersionHistory from '@/components/QuoteVersionHistory.vue';
import { useDictStore } from '@/stores/dict';
import { sheetLines } from '@/utils/ppl';

/**
 * 门户的"历史版本"（R09-7，参考 PPT #9）：时间线与只读的版本明细见 QuoteVersionHistory。
 * 作废的旧轮次照样能看（P-4）
 */
const props = defineProps<{ detail: PortalQuoteDetailDto }>();

const { t, locale } = useI18n();
const dict = useDictStore();

const versions = ref<QuoteVersionSummaryDto[]>([]);
const loading = ref(false);

const lines = computed(() =>
  sheetLines(
    props.detail.lines,
    props.detail.template.columns,
    props.detail.inquiry.currency,
    locale.value as Locale,
    (code) => dict.find('unit', code),
  ),
);

const fetchVersion = (versionNo: number) => portalApi.version(props.detail.id, versionNo);

async function load(): Promise<void> {
  if (props.detail.versionCount === 0) {
    versions.value = [];
    return;
  }
  loading.value = true;
  try {
    versions.value = await portalApi.versions(props.detail.id);
  } finally {
    loading.value = false;
  }
}

// 提交、拒绝后详情会换成新的对象，版本数变了才需要重新加载
watch(
  () => [props.detail.id, props.detail.versionCount],
  () => void load(),
  { immediate: true },
);
</script>

<template>
  <el-card shadow="never" class="qf-card">
    <template #header>
      <span class="section-title">{{ t('portal.versions.title') }}</span>
      <span v-if="detail.versionCount > 0" class="muted">{{
        t('portal.versions.count', { count: detail.versionCount })
      }}</span>
    </template>
    <el-empty v-if="detail.versionCount === 0" :description="t('portal.versions.empty')" :image-size="64" />
    <QuoteVersionHistory
      v-else
      :versions="versions"
      :loading="loading"
      :current-no="detail.currentVersion?.versionNo ?? null"
      :groups="detail.template.groups"
      :columns="detail.template.columns"
      :lines="lines"
      :fetch-version="fetchVersion"
    />
  </el-card>
</template>

<style scoped>
.section-title {
  font-weight: 600;
}
.muted {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
