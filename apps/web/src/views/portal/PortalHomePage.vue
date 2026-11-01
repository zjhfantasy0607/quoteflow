<script setup lang="ts">
import {
  PORTAL_RECENT_RESULT_DAYS,
  PORTAL_WORKBENCH_CARDS,
  type PortalQuoteTab,
  type PortalWorkbenchCardKey,
  type PortalWorkbenchDto,
  type PortalWorkbenchItemDto,
} from '@quoteflow/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import WorkbenchCard from '@/components/WorkbenchCard.vue';
import WorkbenchItem from '@/components/WorkbenchItem.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime } from '@/utils/format';
import { remainingText } from '@/utils/inquiries';

/** 门户首页（M16 §2）：待报价、议价待回复、最近结果；"查看全部"进"我的询价"的对应页签 */
const { t } = useI18n();
const auth = useAuthStore();

const data = ref<PortalWorkbenchDto | null>(null);
const loading = ref(false);

const VIEW_ALL_TAB: Record<PortalWorkbenchCardKey, PortalQuoteTab> = {
  pendingQuotes: 'pending',
  negotiations: 'evaluating',
  recentResults: 'closed',
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await portalApi.workbench();
  } finally {
    loading.value = false;
  }
}

function meta(key: PortalWorkbenchCardKey, item: PortalWorkbenchItemDto): (string | null)[] {
  const round = item.roundNo > 1 ? t('workbench.roundNo', { n: item.roundNo }) : null;
  if (key === 'negotiations') {
    return [
      round,
      item.offeredAt ? t('portal.home.offeredAt', { time: formatDateTime(item.offeredAt) }) : null,
    ];
  }
  if (key === 'recentResults') {
    return [
      round,
      item.evaluatedAt ? t('portal.home.evaluatedAt', { time: formatDateTime(item.evaluatedAt) }) : null,
    ];
  }
  const left = item.deadline ? remainingText(item.deadline) : null;
  return [
    round,
    item.deadline ? t('workbench.deadline', { time: formatDateTime(item.deadline) }) : null,
    left ? t('workbench.remaining', { text: left }) : t('workbench.deadlinePassed'),
  ];
}

onMounted(load);
</script>

<template>
  <div v-loading="loading && !data">
    <PageHeader
      :title="t('portal.home.welcome', { name: auth.me?.user.name ?? '' })"
      :subtitle="t('portal.home.intro')"
    >
      <template #actions>
        <el-button icon="Refresh" :loading="loading" @click="load">{{ t('workbench.refresh') }}</el-button>
      </template>
    </PageHeader>

    <div v-if="data" class="grid">
      <WorkbenchCard
        v-for="key in PORTAL_WORKBENCH_CARDS"
        :key="key"
        :data-card="key"
        :class="{ wide: key === 'pendingQuotes' }"
        :title="t(`portal.home.cards.${key}`)"
        :hint="
          key === 'recentResults'
            ? t('portal.home.recentHint', { days: PORTAL_RECENT_RESULT_DAYS })
            : undefined
        "
        :total="data[key].total"
        :view-all="{ name: 'portal-quotes', query: { tab: VIEW_ALL_TAB[key] } }"
      >
        <WorkbenchItem
          v-for="item in data[key].items"
          :key="item.id"
          :to="{ name: 'portal-quote', params: { quoteId: item.id } }"
          :no="item.inquiry.formalNo"
          :title="item.inquiry.title"
          :meta="meta(key, item)"
        >
          <template #tags>
            <template v-if="key === 'pendingQuotes'">
              <el-tag v-if="item.status === 'SUBMITTED'" type="success" size="small" disable-transitions>
                {{ t('portal.home.submitted') }}
              </el-tag>
              <el-tag v-else type="warning" size="small" disable-transitions>
                {{ t('portal.home.notSubmitted') }}
              </el-tag>
            </template>
            <StatusTag
              v-else-if="key === 'recentResults'"
              enum-name="PortalQuoteStatus"
              :value="item.status"
            />
          </template>
        </WorkbenchItem>
      </WorkbenchCard>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.wide {
  grid-column: 1 / -1;
}
</style>
