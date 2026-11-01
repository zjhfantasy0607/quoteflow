<script setup lang="ts">
import {
  INQUIRY_TABS,
  type InquiryListItemDto,
  type InquiryTab,
  type InquiryUserOptionDto,
} from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { inquiriesApi } from '@/api/inquiries';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, pickName } from '@/utils/format';
import { inquiryNo } from '@/utils/inquiries';

/** 询价单列表（M06 §5）：页签 + 筛选；数据权限由后端过滤 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canEdit = computed(() => auth.hasPerm('inquiry:create') || auth.hasPerm('inquiry:spec'));

const isTab = (v: unknown): v is InquiryTab => INQUIRY_TABS.includes(v as InquiryTab);
// 工作台的"查看全部"带着页签和"只看与我相关"进来（M16）
const tab = ref<'all' | InquiryTab>(isTab(route.query.tab) ? route.query.tab : 'all');
const query = reactive({
  keyword: '',
  projectNo: '',
  materialCategoryId: null as string | null,
  ownerId: '',
  mine: route.query.mine === 'true',
  range: null as [string, string] | null,
  page: 1,
  pageSize: 20,
});
const rows = ref<InquiryListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);
const owners = ref<InquiryUserOptionDto[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await inquiriesApi.list({
      tab: tab.value === 'all' ? undefined : tab.value,
      keyword: query.keyword || undefined,
      projectNo: query.projectNo || undefined,
      materialCategoryId: query.materialCategoryId || undefined,
      ownerId: query.ownerId || undefined,
      mine: query.mine ? 'true' : undefined,
      from: query.range?.[0],
      to: query.range?.[1],
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

function resetQuery(): void {
  Object.assign(query, {
    keyword: '',
    projectNo: '',
    materialCategoryId: null,
    ownerId: '',
    mine: false,
    range: null,
    page: 1,
  });
  void load();
}

function open(row: InquiryListItemDto): void {
  void router.push({ name: 'inquiry-detail', params: { id: row.id } });
}

onMounted(async () => {
  void load();
  // 负责人下拉的候选人接口要 inquiry:create；没有这个权限时不显示负责人筛选
  if (auth.hasPerm('inquiry:create')) owners.value = await inquiriesApi.userOptions().catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="t('inquiries.list.title')" :subtitle="t('inquiries.list.subtitle')">
      <template #actions>
        <el-button
          v-perm="'inquiry:create'"
          type="primary"
          icon="Plus"
          @click="router.push({ name: 'inquiry-new' })"
        >
          {{ t('inquiries.list.create') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-tabs v-model="tab" @tab-change="search">
        <el-tab-pane name="all" :label="t('inquiries.list.tabs.all')" />
        <el-tab-pane
          v-for="name in INQUIRY_TABS"
          :key="name"
          :name="name"
          :label="t(`inquiries.list.tabs.${name}`)"
        />
      </el-tabs>

      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input
            v-model="query.keyword"
            :placeholder="t('inquiries.list.keywordPlaceholder')"
            prefix-icon="Search"
            clearable
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="query.projectNo"
            :placeholder="t('inquiries.list.projectNoPlaceholder')"
            clearable
            style="width: 150px"
          />
        </el-form-item>
        <el-form-item>
          <CategoryTreeSelect
            v-model="query.materialCategoryId"
            allow-disabled
            :placeholder="t('inquiries.list.allCategories')"
            style="width: 190px"
          />
        </el-form-item>
        <el-form-item v-if="owners.length > 0">
          <el-select
            v-model="query.ownerId"
            :placeholder="t('inquiries.list.allOwners')"
            clearable
            filterable
            style="width: 150px"
          >
            <el-option v-for="u in owners" :key="u.id" :value="u.id" :label="u.name" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="query.mine" @change="search">{{ t('inquiries.list.mine') }}</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-date-picker
            v-model="query.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('inquiries.list.dateFrom')"
            :end-placeholder="t('inquiries.list.dateTo')"
            style="width: 250px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{
            t('common.actions.search')
          }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="id">
        <el-table-column :label="t('inquiries.fields.no')" min-width="170">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ inquiryNo(row) }}</el-button>
          </template>
        </el-table-column>
        <el-table-column
          prop="projectNo"
          :label="t('inquiries.fields.projectNo')"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          prop="title"
          :label="t('inquiries.fields.title')"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('inquiries.fields.materialCategory')"
          min-width="130"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ pickName(row.materialCategory, locale) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.status')" width="130">
          <template #default="{ row }"
            ><StatusTag enum-name="InquiryDisplayStatus" :value="row.displayStatus"
          /></template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.round')" width="90">
          <template #default="{ row }">{{ t('inquiries.roundNo', { no: row.currentRoundNo }) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.deadline')" width="150">
          <template #default="{ row }">{{ formatDateTime(row.currentDeadline) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.owner')" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.owner.name }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.fields.createdAt')" width="150">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.table.actions')" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ t('common.actions.view') }}</el-button>
            <el-button
              v-if="canEdit && row.docStatus === 'DRAFT'"
              link
              type="primary"
              @click="router.push({ name: 'inquiry-edit', params: { id: row.id } })"
            >
              {{ t('common.actions.edit') }}
            </el-button>
          </template>
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
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
