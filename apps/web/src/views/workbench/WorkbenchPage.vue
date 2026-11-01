<script setup lang="ts">
import type {
  WorkbenchCardKey,
  WorkbenchContractItemDto,
  WorkbenchDto,
  WorkbenchInquiryItemDto,
} from '@quoteflow/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { workbenchApi } from '@/api/workbench';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import WorkbenchCard from '@/components/WorkbenchCard.vue';
import WorkbenchItem from '@/components/WorkbenchItem.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, pickName } from '@/utils/format';
import { inquiryNo, remainingText } from '@/utils/inquiries';

/** 采购方工作台（M16 §2）：后端按权限决定有哪些卡片，这里按返回的卡片逐张显示 */
const { t, locale } = useI18n();
const auth = useAuthStore();

const data = ref<WorkbenchDto | null>(null);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await workbenchApi.overview();
  } finally {
    loading.value = false;
  }
}

type InquiryCardKey = Exclude<WorkbenchCardKey, 'negotiations' | 'contractsToReview' | 'contractsToApprove'>;
const INQUIRY_CARDS: InquiryCardKey[] = [
  'pendingApproval',
  'myDrafts',
  'readyToPublish',
  'waitingQuotes',
  'toOpen',
];

/** "查看全部"：询价列表的对应页签（与卡片的条件一致） */
const VIEW_ALL: Record<WorkbenchCardKey, RouteLocationRaw> = {
  pendingApproval: { name: 'inquiry-approvals' },
  myDrafts: { name: 'inquiries', query: { tab: 'draft', mine: 'true' } },
  readyToPublish: { name: 'inquiries', query: { tab: 'ready' } },
  waitingQuotes: { name: 'inquiries', query: { tab: 'quoting' } },
  toOpen: { name: 'inquiries', query: { tab: 'closed' } },
  negotiations: { name: 'inquiries', query: { tab: 'evaluating' } },
  contractsToReview: { name: 'contracts', query: { tab: 'PENDING_REVIEW' } },
  contractsToApprove: { name: 'contracts', query: { tab: 'PENDING_APPROVAL' } },
};

const inquiryCards = computed(() =>
  INQUIRY_CARDS.flatMap((key) => {
    const card = data.value?.[key];
    return card ? [{ key, card }] : [];
  }),
);
const contractCards = computed(() =>
  (['contractsToReview', 'contractsToApprove'] as const).flatMap((key) => {
    const card = data.value?.[key];
    return card ? [{ key, card }] : [];
  }),
);
const noCards = computed(() => data.value !== null && Object.keys(data.value).length === 0);

function inquiryLink(key: InquiryCardKey, item: WorkbenchInquiryItemDto): RouteLocationRaw {
  const tab = key === 'waitingQuotes' || key === 'toOpen' ? 'responses' : undefined;
  return { name: 'inquiry-detail', params: { id: item.id }, query: tab ? { tab } : undefined };
}

/** 每种卡片的说明行：负责人 + 这张卡片关心的时间 */
function inquiryMeta(key: InquiryCardKey, item: WorkbenchInquiryItemDto): (string | null)[] {
  const owner = t('workbench.owner', { name: item.owner.name });
  const time = (k: string, value: string | null) => (value ? t(k, { time: formatDateTime(value) }) : null);
  switch (key) {
    case 'pendingApproval':
      return [owner, time('workbench.submittedAt', item.submittedAt)];
    case 'myDrafts':
      return [owner, time('workbench.updatedAt', item.updatedAt)];
    case 'readyToPublish':
      return [owner, time('workbench.approvedAt', item.approvedAt)];
    default: {
      const round = item.currentRoundNo > 1 ? t('workbench.roundNo', { n: item.currentRoundNo }) : null;
      const left = item.currentDeadline ? remainingText(item.currentDeadline) : null;
      return [
        owner,
        round,
        time('workbench.deadline', item.currentDeadline),
        key === 'waitingQuotes' && left ? t('workbench.remaining', { text: left }) : null,
      ];
    }
  }
}

function contractMeta(item: WorkbenchContractItemDto): string[] {
  return [
    `${item.inquiry.formalNo} ${item.inquiry.title}`,
    t('workbench.sentAt', { time: formatDateTime(item.submittedAt) }),
  ];
}

onMounted(load);
</script>

<template>
  <div v-loading="loading && !data">
    <PageHeader
      :title="t('workbench.title')"
      :subtitle="t('workbench.subtitle', { name: auth.me?.user.name ?? '' })"
    >
      <template #actions>
        <el-button icon="Refresh" :loading="loading" @click="load">{{ t('workbench.refresh') }}</el-button>
      </template>
    </PageHeader>

    <el-empty v-if="noCards" :description="t('workbench.noCards')" />
    <div v-else-if="data" class="grid">
      <WorkbenchCard
        v-for="{ key, card } in inquiryCards"
        :key="key"
        :data-card="key"
        :title="t(`workbench.cards.${key}`)"
        :total="card.total"
        :view-all="VIEW_ALL[key]"
      >
        <WorkbenchItem
          v-for="item in card.items"
          :key="item.id"
          :to="inquiryLink(key, item)"
          :no="inquiryNo(item)"
          :title="item.title"
          :meta="inquiryMeta(key, item)"
        >
          <template #tags>
            <el-tag v-if="item.rejected" type="danger" size="small" disable-transitions>
              {{ t('workbench.rejected') }}
            </el-tag>
            <el-tag v-if="item.progress" type="info" size="small" disable-transitions>
              {{ t('workbench.progress', item.progress) }}
            </el-tag>
          </template>
        </WorkbenchItem>
      </WorkbenchCard>

      <WorkbenchCard
        v-if="data.negotiations"
        data-card="negotiations"
        :title="t('workbench.cards.negotiations')"
        :total="data.negotiations.total"
        :view-all="VIEW_ALL.negotiations"
      >
        <WorkbenchItem
          v-for="item in data.negotiations.items"
          :key="item.quoteId"
          :to="{ name: 'inquiry-detail', params: { id: item.inquiry.id }, query: { tab: 'negotiation' } }"
          :no="item.inquiry.formalNo"
          :title="item.inquiry.title"
          :meta="[
            pickName(item.supplier, locale),
            item.roundNo > 1 ? t('workbench.roundNo', { n: item.roundNo }) : null,
            t('workbench.repliedAt', { time: formatDateTime(item.lastMessage.createdAt) }),
          ]"
        >
          <template #tags>
            <StatusTag enum-name="NegotiationMsgType" :value="item.lastMessage.type" />
          </template>
        </WorkbenchItem>
      </WorkbenchCard>

      <WorkbenchCard
        v-for="{ key, card } in contractCards"
        :key="key"
        :data-card="key"
        :title="t(`workbench.cards.${key}`)"
        :total="card.total"
        :view-all="VIEW_ALL[key]"
      >
        <WorkbenchItem
          v-for="item in card.items"
          :key="item.id"
          :to="{ name: 'contract-detail', params: { id: item.id } }"
          :no="item.contractNo"
          :title="pickName(item.supplier, locale)"
          :meta="contractMeta(item)"
        >
          <template #tags>
            <StatusTag enum-name="ContractStatus" :value="item.status" />
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
  align-items: stretch;
}
</style>
