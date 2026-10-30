<script setup lang="ts">
import type { InviteeCandidateDto, InviteeSupplierDto } from '@quoteflow/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import StatusTag from '@/components/StatusTag.vue';
import SupplierCategoryTag from '@/components/SupplierCategoryTag.vue';
import { useSupplierCategoryStore } from '@/stores/supplierCategories';
import { pickName } from '@/utils/format';

/**
 * 候选供应商（R07-1，参考 PPT #3）：按供应商分类（复选框）、主营材料（默认询价单的材料类别，含下级，可清空）、
 * 关键字筛选启用的供应商，翻页也保留勾选。lockedIds 是本轮已经邀请的（补充邀请时显示为已勾选、不能取消）
 */
const props = withDefaults(
  defineProps<{ inquiryId: string; defaultMaterialCategoryId: string | null; lockedIds?: string[] }>(),
  { lockedIds: () => [] },
);
/** 已勾选的供应商（不含 lockedIds），按勾选顺序 */
const selected = defineModel<InviteeSupplierDto[]>({ required: true });

const { t, locale } = useI18n();
const categoryStore = useSupplierCategoryStore();

const query = reactive({
  categoryCodes: [] as string[],
  materialCategoryId: props.defaultMaterialCategoryId as string | null,
  keyword: '',
  page: 1,
  pageSize: 10,
});
const rows = ref<InviteeCandidateDto[]>([]);
const total = ref(0);
const loading = ref(false);

const categories = computed(() => (categoryStore.items ?? []).filter((c) => c.status === 'ENABLED'));
const selectedIds = computed(() => new Set(selected.value.map((s) => s.id)));
const locked = computed(() => new Set(props.lockedIds));
const isLocked = (row: InviteeCandidateDto) => locked.value.has(row.id);
const isChecked = (row: InviteeCandidateDto) => isLocked(row) || selectedIds.value.has(row.id);

const pageRows = computed(() => rows.value.filter((r) => !isLocked(r)));
const pageAll = computed(
  () => pageRows.value.length > 0 && pageRows.value.every((r) => selectedIds.value.has(r.id)),
);
const pageSome = computed(() => !pageAll.value && pageRows.value.some((r) => selectedIds.value.has(r.id)));

function toggle(row: InviteeCandidateDto, checked: boolean): void {
  if (isLocked(row)) return;
  if (checked && !selectedIds.value.has(row.id)) selected.value = [...selected.value, row];
  if (!checked) selected.value = selected.value.filter((s) => s.id !== row.id);
}

function togglePage(checked: boolean): void {
  for (const row of pageRows.value) toggle(row, checked);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await inquiriesApi.candidates(props.inquiryId, {
      categoryCodes: query.categoryCodes.length ? query.categoryCodes.join(',') : undefined,
      materialCategoryId: query.materialCategoryId || undefined,
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

function reset(): void {
  Object.assign(query, {
    categoryCodes: [],
    materialCategoryId: props.defaultMaterialCategoryId,
    keyword: '',
    page: 1,
  });
  void load();
}

const mainCategories = (s: InviteeSupplierDto) =>
  s.materialCategories.map((c) => pickName(c, locale.value)).join(t('common.listSeparator'));

/** 父组件保存或补充邀请后刷新"已受邀"标记 */
defineExpose({ reload: load });

onMounted(() => {
  void categoryStore.load().catch(() => undefined);
  void load();
});
</script>

<template>
  <div>
    <el-form class="filters" label-width="auto" @submit.prevent="search">
      <el-form-item :label="t('inquiries.invitees.filters.category')">
        <!-- 分类和主营材料一改就查询，关键字按回车或"查询" -->
        <el-checkbox-group v-model="query.categoryCodes" @change="search">
          <el-checkbox v-for="c in categories" :key="c.code" :value="c.code">{{
            pickName(c, locale)
          }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item :label="t('inquiries.invitees.filters.materialCategory')">
        <div class="filter-row">
          <CategoryTreeSelect
            v-model="query.materialCategoryId"
            allow-disabled
            @update:model-value="search"
            :placeholder="t('inquiries.invitees.filters.allMaterialCategories')"
            style="width: 240px"
          />
          <el-input
            v-model="query.keyword"
            :placeholder="t('inquiries.invitees.filters.keyword')"
            prefix-icon="Search"
            clearable
            style="width: 220px"
          />
          <el-button type="primary" native-type="submit" icon="Search">{{
            t('common.actions.search')
          }}</el-button>
          <el-button icon="Refresh" @click="reset">{{ t('common.actions.reset') }}</el-button>
        </div>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" row-key="id">
      <el-table-column width="48">
        <template #header>
          <el-checkbox
            :model-value="pageAll"
            :indeterminate="pageSome"
            :disabled="pageRows.length === 0"
            :title="t('inquiries.invitees.selectPage')"
            @update:model-value="(v: unknown) => togglePage(!!v)"
          />
        </template>
        <template #default="{ row }">
          <el-checkbox
            :model-value="isChecked(row)"
            :disabled="isLocked(row)"
            @update:model-value="(v: unknown) => toggle(row, !!v)"
          />
        </template>
      </el-table-column>
      <el-table-column prop="code" :label="t('inquiries.invitees.fields.code')" width="130" />
      <el-table-column :label="t('inquiries.invitees.fields.name')" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <!-- 标签放在名称前面，名称太长被截断时也能看到 -->
          <el-tag v-if="row.invited || isLocked(row)" size="small" type="success" class="invited">
            {{ t('inquiries.invitees.invited') }}
          </el-tag>
          {{ pickName(row, locale) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.invitees.fields.category')" width="120">
        <template #default="{ row }"><SupplierCategoryTag :code="row.categoryCode" /></template>
      </el-table-column>
      <el-table-column
        :label="t('inquiries.invitees.fields.materialCategories')"
        min-width="150"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ mainCategories(row) }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.invitees.fields.portalAccount')" width="140">
        <template #default="{ row }">
          <StatusTag enum-name="PortalAccountState" :value="row.portalAccount" />
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        size="small"
        @current-change="load"
      />
    </div>
  </div>
</template>

<style scoped>
.filters :deep(.el-form-item) {
  margin-bottom: 12px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filter-row .el-button + .el-button {
  margin-left: 0;
}
.invited {
  margin-right: 6px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
