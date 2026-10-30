<script setup lang="ts">
import { PORTAL_QUOTE_TABS, type PortalQuoteTab } from '@quoteflow/shared';
import { onMounted, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';

/** 门户首页（M08 只有各页签的数量，M16 完善） */
const { t } = useI18n();
const auth = useAuthStore();
const counts = reactive<Record<PortalQuoteTab, number | null>>({
  pending: null,
  evaluating: null,
  closed: null,
});

onMounted(async () => {
  await Promise.all(
    PORTAL_QUOTE_TABS.map(async (tab) => {
      counts[tab] = (await portalApi.quotes({ tab, page: 1, pageSize: 1 })).total;
    }),
  );
});
</script>

<template>
  <div>
    <PageHeader
      :title="t('portal.home.welcome', { name: auth.me?.user.name ?? '' })"
      :subtitle="t('portal.home.intro')"
    />
    <el-row :gutter="16">
      <el-col v-for="tab in PORTAL_QUOTE_TABS" :key="tab" :span="8">
        <router-link :to="{ name: 'portal-quotes', query: { tab } }" class="card-link">
          <el-card shadow="hover" class="count-card">
            <div class="label">{{ t(`portal.home.${tab}`) }}</div>
            <div class="value" :class="{ highlight: tab === 'pending' && counts.pending }">
              {{ counts[tab] ?? '—' }}
            </div>
          </el-card>
        </router-link>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.card-link {
  text-decoration: none;
}
.label {
  color: var(--el-text-color-secondary);
}
.value {
  margin-top: 8px;
  font-size: 32px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.value.highlight {
  color: var(--el-color-primary);
}
</style>
