<script setup lang="ts">
import type { EnableStatus, MaterialDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { filesApi } from '@/api/files';
import { materialsApi } from '@/api/materials';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictTag from '@/components/DictTag.vue';
import ExcelImportDialog from '@/components/ExcelImportDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import MaterialFormDialog from './MaterialFormDialog.vue';

const { t, locale } = useI18n();
const auth = useAuthStore();
const canManage = computed(() => auth.hasPerm('material:manage'));

const query = reactive({
  keyword: '',
  categoryId: null as string | null,
  status: '' as '' | EnableStatus,
  page: 1,
  pageSize: 20,
});
const rows = ref<MaterialDto[]>([]);
const total = ref(0);
const loading = ref(false);
const exporting = ref(false);
const formVisible = ref(false);
const editing = ref<MaterialDto | null>(null);
const importVisible = ref(false);

/** 列表和导出共用的筛选条件（R03-8 导出按当前筛选） */
function filters() {
  return {
    keyword: query.keyword || undefined,
    categoryId: query.categoryId || undefined,
    status: query.status || undefined,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await materialsApi.list({ ...filters(), page: query.page, pageSize: query.pageSize });
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
  Object.assign(query, { keyword: '', categoryId: null, status: '', page: 1 });
  void load();
}

function openCreate(): void {
  editing.value = null;
  formVisible.value = true;
}

function openEdit(material: MaterialDto): void {
  editing.value = material;
  formVisible.value = true;
}

async function toggleStatus(material: MaterialDto): Promise<void> {
  const disabling = material.status === 'ENABLED';
  const name = pickName(material, locale.value);
  const message = t(disabling ? 'materials.list.disableConfirm' : 'materials.list.enableConfirm', { name });
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  try {
    await materialsApi.setStatus(material.id, disabling ? 'DISABLED' : 'ENABLED');
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('common.saved'));
  await load();
}

async function exportExcel(): Promise<void> {
  exporting.value = true;
  try {
    await materialsApi.export(filters());
  } finally {
    exporting.value = false;
  }
}

const thumbnail = (m: MaterialDto) => (m.image ? filesApi.contentUrl(m.image.id, 'inline') : '');

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('materials.list.title')" :subtitle="t('materials.list.subtitle')">
      <template #actions>
        <el-button v-perm="'material:manage'" type="primary" icon="Plus" @click="openCreate">
          {{ t('materials.list.create') }}
        </el-button>
        <el-button v-perm="'material:import'" icon="Upload" @click="importVisible = true">
          {{ t('materials.list.import') }}
        </el-button>
        <el-button v-perm="'material:export'" icon="Download" :loading="exporting" @click="exportExcel">
          {{ t('materials.list.export') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input
            v-model="query.keyword"
            :placeholder="t('materials.list.keywordPlaceholder')"
            prefix-icon="Search"
            clearable
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <CategoryTreeSelect
            v-model="query.categoryId"
            allow-disabled
            :placeholder="t('materials.list.allCategories')"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.status" :placeholder="t('materials.list.allStatus')" clearable style="width: 140px">
            <el-option value="ENABLED" :label="t('enums.EnableStatus.ENABLED')" />
            <el-option value="DISABLED" :label="t('enums.EnableStatus.DISABLED')" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{ t('common.actions.search') }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')">
        <el-table-column :label="t('materials.list.fields.image')" width="72">
          <template #default="{ row }">
            <el-image
              v-if="row.image"
              :src="thumbnail(row)"
              :preview-src-list="[thumbnail(row)]"
              fit="cover"
              class="thumb"
              preview-teleported
              hide-on-click-modal
            />
            <div v-else class="thumb placeholder"><el-icon><Picture /></el-icon></div>
          </template>
        </el-table-column>
        <el-table-column prop="code" :label="t('materials.list.fields.code')" min-width="120" />
        <el-table-column :label="t('materials.list.fields.name')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ pickName(row, locale) }}</template>
        </el-table-column>
        <el-table-column prop="spec" :label="t('materials.list.fields.spec')" min-width="190" show-overflow-tooltip />
        <el-table-column :label="t('materials.list.fields.unit')" width="80">
          <template #default="{ row }"><DictTag type="unit" :code="row.unitCode" plain /></template>
        </el-table-column>
        <el-table-column :label="t('materials.list.fields.category')" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tooltip v-if="!row.category.effectiveEnabled" :content="t('materials.list.categoryOff')" placement="top">
              <el-icon class="category-off-icon"><WarningFilled /></el-icon>
            </el-tooltip>
            <span :class="{ 'category-off': !row.category.effectiveEnabled }">{{ pickName(row.category, locale) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="brand" :label="t('materials.list.fields.brand')" min-width="100" show-overflow-tooltip />
        <el-table-column :label="t('materials.list.fields.status')" width="90">
          <template #default="{ row }"><StatusTag enum-name="EnableStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column v-if="canManage" :label="t('common.table.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ t('common.actions.edit') }}</el-button>
            <el-button link :type="row.status === 'ENABLED' ? 'danger' : 'success'" @click="toggleStatus(row)">
              {{ row.status === 'ENABLED' ? t('materials.list.disable') : t('materials.list.enable') }}
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

    <MaterialFormDialog v-model="formVisible" :material="editing" @saved="load" />
    <ExcelImportDialog
      v-model="importVisible"
      :title="t('materials.list.importTitle')"
      :template-url="materialsApi.templateUrl"
      :upload="materialsApi.import"
      @imported="search"
    />
  </div>
</template>

<style scoped>
.thumb {
  display: block;
  width: 48px;
  height: 48px;
  border-radius: 4px;
}
.thumb.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  font-size: 20px;
  background: var(--el-fill-color-light);
}
.category-off {
  color: var(--el-text-color-placeholder);
}
.category-off-icon {
  margin-right: 4px;
  color: var(--el-color-warning);
  vertical-align: -2px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
