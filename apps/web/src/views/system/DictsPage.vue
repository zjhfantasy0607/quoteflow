<script setup lang="ts">
import type { DictItemDto, DictTypeDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { dictAdminApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictStore } from '@/stores/dict';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import DictItemFormDialog from './DictItemFormDialog.vue';
import DictTypeFormDialog from './DictTypeFormDialog.vue';

const { t, locale } = useI18n();
const auth = useAuthStore();
const dict = useDictStore();
const canManage = computed(() => auth.hasPerm('system:dict:manage'));

const types = ref<DictTypeDto[]>([]);
const keyword = ref('');
const selectedCode = ref<string | null>(null);
const items = ref<DictItemDto[]>([]);
const loadingItems = ref(false);
const typeDialog = ref(false);
const editingType = ref<DictTypeDto | null>(null);
const itemDialog = ref(false);
const editingItem = ref<DictItemDto | null>(null);

const selected = computed(() => types.value.find((x) => x.code === selectedCode.value) ?? null);
const filteredTypes = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return types.value;
  return types.value.filter(
    (x) => x.code.includes(k) || x.nameZh.toLowerCase().includes(k) || x.nameEn.toLowerCase().includes(k),
  );
});

async function loadTypes(): Promise<void> {
  types.value = await dictAdminApi.types();
}

async function loadItems(): Promise<void> {
  if (!selectedCode.value) return;
  loadingItems.value = true;
  try {
    items.value = await dictAdminApi.items(selectedCode.value);
  } finally {
    loadingItems.value = false;
  }
}

async function select(code: string): Promise<void> {
  selectedCode.value = code;
  await loadItems();
}

/** 字典改动后让其他页面的下拉重新加载（R02-2） */
async function afterChange(code: string): Promise<void> {
  dict.invalidate([code]);
  await Promise.all([loadTypes(), loadItems()]);
}

function openCreateType(): void {
  editingType.value = null;
  typeDialog.value = true;
}

function openEditType(): void {
  editingType.value = selected.value;
  typeDialog.value = true;
}

async function onTypeSaved(code: string): Promise<void> {
  dict.invalidate([code]);
  await loadTypes();
  await select(code);
}

async function deleteType(): Promise<void> {
  const type = selected.value;
  if (!type) return;
  if (!(await confirmAction(t('system.dicts.deleteTypeConfirm', { name: pickName(type, locale.value) })))) return;
  await dictAdminApi.deleteType(type.code);
  dict.invalidate([type.code]);
  ElMessage.success(t('system.dicts.deleted'));
  selectedCode.value = null;
  items.value = [];
  await loadTypes();
}

function openCreateItem(): void {
  editingItem.value = null;
  itemDialog.value = true;
}

function openEditItem(item: DictItemDto): void {
  editingItem.value = item;
  itemDialog.value = true;
}

async function toggleItem(item: DictItemDto): Promise<void> {
  const disabling = item.status === 'ENABLED';
  if (disabling && !(await confirmAction(t('system.dicts.disableItemConfirm', { name: pickName(item, locale.value) })))) {
    return;
  }
  try {
    await dictAdminApi.updateItem(item.id, {
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      sort: item.sort,
      remark: item.remark ?? undefined,
      status: disabling ? 'DISABLED' : 'ENABLED',
    });
    ElMessage.success(t('common.saved'));
    await afterChange(item.typeCode);
  } catch (err) {
    ElMessage.error(translateError(apiError(err)));
  }
}

async function deleteItem(item: DictItemDto): Promise<void> {
  if (!(await confirmAction(t('system.dicts.deleteItemConfirm', { name: pickName(item, locale.value) })))) return;
  await dictAdminApi.deleteItem(item.id);
  ElMessage.success(t('system.dicts.deleted'));
  await afterChange(item.typeCode);
}

onMounted(async () => {
  await loadTypes();
  if (types.value.length > 0) await select(types.value[0].code);
});
</script>

<template>
  <div>
    <PageHeader :title="t('system.dicts.title')" :subtitle="t('system.dicts.subtitle')">
      <template #actions>
        <el-button v-perm="'system:dict:manage'" type="primary" icon="Plus" @click="openCreateType">
          {{ t('system.dicts.createType') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="dicts-layout">
      <el-card shadow="never" class="type-list" body-style="padding: 12px">
        <el-input v-model="keyword" :placeholder="t('system.dicts.searchPlaceholder')" prefix-icon="Search" clearable />
        <ul class="types">
          <li
            v-for="x in filteredTypes"
            :key="x.code"
            :class="{ active: x.code === selectedCode }"
            @click="select(x.code)"
          >
            <div class="type-main">
              <span class="name">{{ pickName(x, locale) }}</span>
              <span class="code">{{ x.code }}</span>
            </div>
            <el-tag v-if="x.isSystem" size="small" type="info" disable-transitions>{{ t('system.dicts.system') }}</el-tag>
            <span class="count">{{ t('system.dicts.itemCount', { count: x.itemCount }) }}</span>
          </li>
        </ul>
      </el-card>

      <el-card shadow="never" class="item-panel">
        <el-empty v-if="!selected" :description="t('system.dicts.empty')" />
        <template v-else>
          <div class="panel-header">
            <div>
              <h3 class="panel-title">{{ pickName(selected, locale) }}</h3>
              <div class="panel-code">{{ selected.code }}</div>
            </div>
            <div v-if="canManage" class="panel-actions">
              <el-button icon="Edit" @click="openEditType">{{ t('system.dicts.editType') }}</el-button>
              <el-button v-if="!selected.isSystem" icon="Delete" type="danger" plain @click="deleteType">
                {{ t('system.dicts.deleteType') }}
              </el-button>
              <el-button type="primary" icon="Plus" @click="openCreateItem">{{ t('system.dicts.createItem') }}</el-button>
            </div>
          </div>
          <el-alert
            v-if="selected.isSystem"
            :title="t('system.dicts.systemTypeHint')"
            type="info"
            show-icon
            :closable="false"
            class="hint"
          />

          <el-table v-loading="loadingItems" :data="items" :empty-text="t('common.table.empty')">
            <el-table-column prop="code" :label="t('system.dicts.itemFields.code')" min-width="140" />
            <el-table-column prop="nameZh" :label="t('system.dicts.itemFields.nameZh')" min-width="140" />
            <el-table-column prop="nameEn" :label="t('system.dicts.itemFields.nameEn')" min-width="160" />
            <el-table-column prop="sort" :label="t('system.dicts.itemFields.sort')" width="90" />
            <el-table-column :label="t('system.dicts.itemFields.status')" width="100">
              <template #default="{ row }"><StatusTag enum-name="EnableStatus" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="remark" :label="t('system.dicts.itemFields.remark')" min-width="160" show-overflow-tooltip />
            <el-table-column v-if="canManage" :label="t('common.table.actions')" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEditItem(row)">{{ t('common.actions.edit') }}</el-button>
                <el-button link :type="row.status === 'ENABLED' ? 'warning' : 'success'" @click="toggleItem(row)">
                  {{ row.status === 'ENABLED' ? t('system.dicts.disable') : t('system.dicts.enable') }}
                </el-button>
                <el-button v-if="!selected.isSystem" link type="danger" @click="deleteItem(row)">
                  {{ t('common.actions.delete') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-card>
    </div>

    <DictTypeFormDialog v-model="typeDialog" :type="editingType" @saved="onTypeSaved" />
    <DictItemFormDialog
      v-if="selectedCode"
      v-model="itemDialog"
      :type-code="selectedCode"
      :item="editingItem"
      @saved="afterChange(selectedCode!)"
    />
  </div>
</template>

<style scoped>
.dicts-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.type-list {
  flex: 0 0 300px;
}
.item-panel {
  flex: 1;
  min-width: 0;
}
.types {
  max-height: calc(100vh - 260px);
  margin: 12px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.types li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.types li:hover {
  background: var(--el-fill-color-light);
}
.types li.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.type-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.type-main .name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.type-main .code,
.count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-title {
  margin: 0;
  font-size: 16px;
}
.panel-code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.panel-actions {
  display: flex;
  gap: 8px;
}
.hint {
  margin-bottom: 12px;
}
</style>
