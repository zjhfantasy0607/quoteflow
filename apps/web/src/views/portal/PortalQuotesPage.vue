<script setup lang="ts">
import { PORTAL_QUOTE_TABS, type PortalQuoteListItemDto, type PortalQuoteTab } from '@quoteflow/shared';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { portalApi } from '@/api/portal';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatDateTime } from '@/utils/format';
import { remainingText } from '@/utils/inquiries';
import { portalQuoteStatus } from '@/utils/portal';

/** 我的询价（R08-1）：待处理 / 评标中 / 已结束；待处理的按截止时间先后，显示倒计时，已截止标红 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const isTab = (v: unknown): v is PortalQuoteTab => (PORTAL_QUOTE_TABS as readonly unknown[]).includes(v);
const query = reactive({
  tab: (isTab(route.query.tab) ? route.query.tab : 'pending') as PortalQuoteTab,
  keyword: '',
  page: 1,
  pageSize: 20,
});
const rows = ref<PortalQuoteListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await portalApi.quotes({
      tab: query.tab,
      keyword: query.keyword || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search(): void {
  query.page = 1;
  void load();
}

function switchTab(): void {
  void router.replace({ query: { tab: query.tab } });
  search();
}

function open(row: PortalQuoteListItemDto): void {
  void router.push({ name: 'portal-quote', params: { quoteId: row.id } });
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('portal.quotes.title')" :subtitle="t('portal.quotes.subtitle')" />
    <el-card shadow="never" class="qf-card">
      <el-tabs v-model="query.tab" @tab-change="switchTab">
        <el-tab-pane
          v-for="tab in PORTAL_QUOTE_TABS"
          :key="tab"
          :name="tab"
          :label="t(`portal.quotes.tabs.${tab}`)"
        />
      </el-tabs>
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input
            v-model="query.keyword"
            :placeholder="t('portal.quotes.keywordPlaceholder')"
            prefix-icon="Search"
            clearable
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{
            t('common.actions.search')
          }}</el-button>
        </el-form-item>
      </el-form>

      <el-table
        v-loading="loading"
        :data="rows"
        :empty-text="t('portal.quotes.empty')"
        class="clickable"
        @row-click="open"
      >
        <el-table-column :label="t('portal.quotes.fields.formalNo')" width="170">
          <template #default="{ row }">
            <router-link :to="{ name: 'portal-quote', params: { quoteId: row.id } }" class="link" @click.stop>
              {{ row.inquiry.formalNo }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column :label="t('portal.quotes.fields.title')" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.inquiry.title }}</template>
        </el-table-column>
        <el-table-column :label="t('portal.quotes.fields.round')" width="100">
          <template #default="{ row }">{{ t('portal.quotes.roundNo', { no: row.roundNo }) }}</template>
        </el-table-column>
        <el-table-column :label="t('portal.quotes.fields.deadline')" width="210">
          <template #default="{ row }">
            <div>{{ formatDateTime(row.deadline) }}</div>
            <template v-if="row.roundStatus === 'WAITING_QUOTES' && row.deadline">
              <div v-if="remainingText(row.deadline)" class="left">
                {{ t('portal.quotes.left', { time: remainingText(row.deadline) }) }}
              </div>
              <div v-else class="passed">{{ t('portal.quotes.passed') }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column :label="t('portal.quotes.fields.status')" width="130">
          <template #default="{ row }">
            <StatusTag
              enum-name="PortalQuoteStatus"
              :value="portalQuoteStatus(row.status, row.roundStatus)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('portal.quotes.fields.lastSubmittedAt')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.lastSubmittedAt) || '—' }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.clickable :deep(.el-table__row) {
  cursor: pointer;
}
.link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.left {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.passed {
  color: var(--el-color-danger);
  font-size: 12px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
