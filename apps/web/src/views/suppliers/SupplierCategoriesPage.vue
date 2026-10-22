<script setup lang="ts">
import { updateDictItemSchema, type DictItemDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { supplierCategoriesApi } from '@/api/suppliers';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useDictStore } from '@/stores/dict';
import { useSupplierCategoryStore } from '@/stores/supplierCategories';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import SupplierCategoryFormDialog from './SupplierCategoryFormDialog.vue';

/** 供应商分类页（R04-9）：新增、改名、排序、停用；分类不能删除 */
const { t, locale } = useI18n();
const store = useSupplierCategoryStore();
const dict = useDictStore();

const loading = ref(false);
const formVisible = ref(false);
const editing = ref<DictItemDto | null>(null);
const rows = computed(() => store.items ?? []);
const nextSort = computed(() => rows.value.reduce((max, c) => Math.max(max, c.sort), 0) + 1);

async function reload(): Promise<void> {
  loading.value = true;
  try {
    await store.load(true);
    // 其他页面用的字典缓存（启用的分类）也要刷新
    dict.invalidate(['supplier_category']);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  formVisible.value = true;
}

function openEdit(item: DictItemDto): void {
  editing.value = item;
  formVisible.value = true;
}

async function toggleStatus(item: DictItemDto): Promise<void> {
  const disabling = item.status === 'ENABLED';
  const name = pickName(item, locale.value);
  const message = t(
    disabling ? 'suppliers.categories.disableConfirm' : 'suppliers.categories.enableConfirm',
    { name },
  );
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  const body = updateDictItemSchema.parse({
    nameZh: item.nameZh,
    nameEn: item.nameEn,
    sort: item.sort,
    remark: item.remark ?? '',
    status: disabling ? 'DISABLED' : 'ENABLED',
  });
  try {
    await supplierCategoriesApi.update(item.id, body);
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('common.saved'));
  await reload();
}

onMounted(() => {
  loading.value = true;
  void store.load(true).finally(() => (loading.value = false));
});
</script>

<template>
  <div>
    <PageHeader :title="t('suppliers.categories.title')" :subtitle="t('suppliers.categories.subtitle')">
      <template #actions>
        <el-button type="primary" icon="Plus" @click="openCreate">
          {{ t('suppliers.categories.create') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')">
        <el-table-column prop="code" :label="t('suppliers.categories.fields.code')" min-width="140" />
        <el-table-column prop="nameZh" :label="t('suppliers.categories.fields.nameZh')" min-width="160" />
        <el-table-column prop="nameEn" :label="t('suppliers.categories.fields.nameEn')" min-width="160" />
        <el-table-column prop="sort" :label="t('suppliers.categories.fields.sort')" width="90" />
        <el-table-column :label="t('suppliers.categories.fields.status')" width="100">
          <template #default="{ row }"><StatusTag enum-name="EnableStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column
          prop="remark"
          :label="t('suppliers.categories.fields.remark')"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column :label="t('common.table.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ t('common.actions.edit') }}</el-button>
            <el-button
              link
              :type="row.status === 'ENABLED' ? 'danger' : 'success'"
              @click="toggleStatus(row)"
            >
              {{
                row.status === 'ENABLED'
                  ? t('suppliers.categories.disable')
                  : t('suppliers.categories.enable')
              }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="hint">{{ t('suppliers.categories.noDeleteHint') }}</div>
    </el-card>

    <SupplierCategoryFormDialog v-model="formVisible" :item="editing" :next-sort="nextSort" @saved="reload" />
  </div>
</template>

<style scoped>
.hint {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
