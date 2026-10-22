<script setup lang="ts">
import type { EnableStatus, SupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { suppliersApi } from '@/api/suppliers';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import ExcelImportDialog from '@/components/ExcelImportDialog.vue';
import MaskedValue from '@/components/MaskedValue.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import SupplierCategorySelect from '@/components/SupplierCategorySelect.vue';
import SupplierCategoryTag from '@/components/SupplierCategoryTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import { isMasked } from '@/utils/masked';
import { supplierLanguageLabel } from '@/utils/suppliers';
import SupplierFormDialog from './SupplierFormDialog.vue';

const { t, locale } = useI18n();
const auth = useAuthStore();
const canManage = computed(() => auth.hasPerm('supplier:manage'));

const query = reactive({
  keyword: '',
  categoryCodes: [] as string[],
  materialCategoryId: null as string | null,
  status: '' as '' | EnableStatus,
  page: 1,
  pageSize: 20,
});
const rows = ref<SupplierDto[]>([]);
const total = ref(0);
const loading = ref(false);
const exporting = ref(false);
const formVisible = ref(false);
const editing = ref<SupplierDto | null>(null);
const importVisible = ref(false);

/** 列表和导出共用的筛选条件（R04-5） */
function filters() {
  return {
    keyword: query.keyword || undefined,
    categoryCodes: query.categoryCodes.length ? query.categoryCodes.join(',') : undefined,
    materialCategoryId: query.materialCategoryId || undefined,
    status: query.status || undefined,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await suppliersApi.list({ ...filters(), page: query.page, pageSize: query.pageSize });
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
  Object.assign(query, { keyword: '', categoryCodes: [], materialCategoryId: null, status: '', page: 1 });
  void load();
}

function openCreate(): void {
  editing.value = null;
  formVisible.value = true;
}

function openEdit(supplier: SupplierDto): void {
  editing.value = supplier;
  formVisible.value = true;
}

async function toggleStatus(supplier: SupplierDto): Promise<void> {
  const disabling = supplier.status === 'ENABLED';
  const name = pickName(supplier, locale.value);
  const message = t(disabling ? 'suppliers.list.disableConfirm' : 'suppliers.list.enableConfirm', { name });
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  try {
    await suppliersApi.setStatus(supplier.id, disabling ? 'DISABLED' : 'ENABLED');
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('common.saved'));
  await load();
}

async function exportExcel(): Promise<void> {
  exporting.value = true;
  try {
    await suppliersApi.export(filters());
  } finally {
    exporting.value = false;
  }
}

const mainCategories = (s: SupplierDto) =>
  s.materialCategories.map((c) => pickName(c, locale.value)).join(t('common.listSeparator'));

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('suppliers.list.title')" :subtitle="t('suppliers.list.subtitle')">
      <template #actions>
        <el-button v-perm="'supplier:manage'" type="primary" icon="Plus" @click="openCreate">
          {{ t('suppliers.list.create') }}
        </el-button>
        <el-button v-perm="'supplier:import'" icon="Upload" @click="importVisible = true">
          {{ t('suppliers.list.import') }}
        </el-button>
        <el-button v-perm="'supplier:export'" icon="Download" :loading="exporting" @click="exportExcel">
          {{ t('suppliers.list.export') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input
            v-model="query.keyword"
            :placeholder="t('suppliers.list.keywordPlaceholder')"
            prefix-icon="Search"
            clearable
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <div style="width: 240px">
            <SupplierCategorySelect
              v-model="query.categoryCodes"
              multiple
              allow-disabled
              :placeholder="t('suppliers.list.allCategories')"
            />
          </div>
        </el-form-item>
        <el-form-item>
          <CategoryTreeSelect
            v-model="query.materialCategoryId"
            allow-disabled
            :placeholder="t('suppliers.list.allMaterialCategories')"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="query.status"
            :placeholder="t('suppliers.list.allStatus')"
            clearable
            style="width: 130px"
          >
            <el-option value="ENABLED" :label="t('enums.EnableStatus.ENABLED')" />
            <el-option value="DISABLED" :label="t('enums.EnableStatus.DISABLED')" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">
            {{ t('common.actions.search') }}
          </el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')">
        <el-table-column :label="t('suppliers.list.fields.code')" width="110">
          <template #default="{ row }">
            <router-link :to="{ name: 'supplier-detail', params: { id: row.id } }" class="link">
              {{ row.code }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column :label="t('suppliers.list.fields.name')" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ pickName(row, locale) }}</template>
        </el-table-column>
        <el-table-column :label="t('suppliers.list.fields.category')" width="120">
          <template #default="{ row }"><SupplierCategoryTag :code="row.categoryCode" /></template>
        </el-table-column>
        <el-table-column
          :label="t('suppliers.list.fields.materialCategories')"
          min-width="140"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ mainCategories(row) }}</template>
        </el-table-column>
        <el-table-column
          prop="contactName"
          :label="t('suppliers.list.fields.contactName')"
          min-width="100"
          show-overflow-tooltip
        />
        <el-table-column :label="t('suppliers.list.fields.contactPhone')" min-width="130">
          <template #default="{ row }">
            <MaskedValue :masked="isMasked(row, 'contactPhone')">{{ row.contactPhone }}</MaskedValue>
          </template>
        </el-table-column>
        <el-table-column :label="t('suppliers.list.fields.language')" width="100">
          <template #default="{ row }">{{ supplierLanguageLabel(row.preferredLanguage) }}</template>
        </el-table-column>
        <el-table-column :label="t('suppliers.list.fields.status')" width="90">
          <template #default="{ row }"><StatusTag enum-name="EnableStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column v-if="canManage" :label="t('common.table.actions')" width="120" fixed="right">
          <template #default="{ row }">
            <el-tooltip
              :disabled="!row.maskedFields?.length"
              :content="t('suppliers.list.maskedEditHint')"
              placement="top"
            >
              <span class="action">
                <el-button link type="primary" :disabled="!!row.maskedFields?.length" @click="openEdit(row)">
                  {{ t('common.actions.edit') }}
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              link
              :type="row.status === 'ENABLED' ? 'danger' : 'success'"
              @click="toggleStatus(row)"
            >
              {{ row.status === 'ENABLED' ? t('suppliers.list.disable') : t('suppliers.list.enable') }}
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

    <SupplierFormDialog v-model="formVisible" :supplier="editing" @saved="load" />
    <ExcelImportDialog
      v-model="importVisible"
      :title="t('suppliers.list.importTitle')"
      :template-url="suppliersApi.templateUrl"
      :upload="suppliersApi.import"
      @imported="search"
    />
  </div>
</template>

<style scoped>
.link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.action {
  margin-right: 12px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
