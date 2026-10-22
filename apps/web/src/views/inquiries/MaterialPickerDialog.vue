<script setup lang="ts">
import { quantitySchema, type MaterialCategoryNodeDto, type MaterialDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { materialsApi } from '@/api/materials';
import DictTag from '@/components/DictTag.vue';
import { useCategoryStore } from '@/stores/categories';
import { pickName } from '@/utils/format';

/**
 * 从材料库选用（#31、R06-2）：左边按分类（含下级）筛选，右边搜索、勾选启用的材料；
 * 可以翻页继续勾选，下方填写各自的数量后一起添加
 */
defineProps<{ saving?: boolean }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ confirm: [{ materialId: string; quantity: string }[]] }>();

const { t, locale } = useI18n();
const categories = useCategoryStore();

const query = reactive({ keyword: '', categoryId: null as string | null, page: 1, pageSize: 10 });
const rows = ref<MaterialDto[]>([]);
const total = ref(0);
const loading = ref(false);
/** 已勾选的材料（跨页保留），按勾选顺序 */
const picked = ref<{ material: MaterialDto; quantity: string; error: boolean }[]>([]);

/** 只显示有效启用的分类 */
const tree = computed(() => {
  const filter = (nodes: MaterialCategoryNodeDto[]): MaterialCategoryNodeDto[] =>
    nodes.filter((n) => n.effectiveEnabled).map((n) => ({ ...n, children: filter(n.children) }));
  return filter(categories.tree ?? []);
});

const isPicked = (m: MaterialDto) => picked.value.some((p) => p.material.id === m.id);

function toggle(m: MaterialDto, checked: boolean): void {
  if (checked && !isPicked(m)) picked.value.push({ material: m, quantity: '', error: false });
  if (!checked) picked.value = picked.value.filter((p) => p.material.id !== m.id);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await materialsApi.list({
      keyword: query.keyword || undefined,
      categoryId: query.categoryId || undefined,
      status: 'ENABLED',
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

function selectCategory(id: string | null): void {
  query.categoryId = id;
  search();
}

function confirm(): void {
  if (picked.value.length === 0) {
    ElMessage.warning(t('inquiries.picker.noneSelected'));
    return;
  }
  let ok = true;
  for (const p of picked.value) {
    p.error = !quantitySchema.safeParse(p.quantity).success;
    if (p.error) ok = false;
  }
  if (!ok) return;
  emit(
    'confirm',
    picked.value.map((p) => ({ materialId: p.material.id, quantity: p.quantity.trim() })),
  );
}

watch(visible, (open) => {
  if (!open) return;
  picked.value = [];
  Object.assign(query, { keyword: '', categoryId: null, page: 1 });
  void categories.load().catch(() => undefined);
  void load();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('inquiries.picker.title')"
    width="1000px"
    top="5vh"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="picker">
      <div class="tree">
        <el-button
          link
          :type="query.categoryId === null ? 'primary' : 'default'"
          @click="selectCategory(null)"
        >
          {{ t('inquiries.picker.allCategories') }}
        </el-button>
        <el-tree
          :data="tree"
          node-key="id"
          :props="{ label: (n: MaterialCategoryNodeDto) => pickName(n, locale), children: 'children' }"
          :current-node-key="query.categoryId ?? undefined"
          highlight-current
          :expand-on-click-node="false"
          @node-click="(n: MaterialCategoryNodeDto) => selectCategory(n.id)"
        />
      </div>
      <div class="main">
        <el-form inline @submit.prevent="search">
          <el-form-item>
            <el-input
              v-model="query.keyword"
              :placeholder="t('inquiries.picker.searchPlaceholder')"
              prefix-icon="Search"
              clearable
              style="width: 260px"
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
          :empty-text="t('common.table.empty')"
          height="300"
          row-key="id"
        >
          <el-table-column width="48">
            <template #default="{ row }">
              <el-checkbox
                :model-value="isPicked(row)"
                @update:model-value="(v: unknown) => toggle(row, !!v)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="code" :label="t('inquiries.lines.fields.materialCode')" min-width="120" />
          <el-table-column :label="t('inquiries.lines.fields.name')" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ pickName(row, locale) }}</template>
          </el-table-column>
          <el-table-column
            prop="spec"
            :label="t('inquiries.lines.fields.spec')"
            min-width="200"
            show-overflow-tooltip
          />
          <el-table-column :label="t('inquiries.lines.fields.unit')" width="80">
            <template #default="{ row }"><DictTag type="unit" :code="row.unitCode" plain /></template>
          </el-table-column>
          <el-table-column
            :label="t('inquiries.lines.fields.category')"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ pickName(row.category, locale) }}</template>
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
    </div>

    <div class="picked-title">
      {{
        picked.length
          ? t('inquiries.picker.selected', { count: picked.length })
          : t('inquiries.picker.noneSelected')
      }}
    </div>
    <el-table
      v-if="picked.length"
      :data="picked"
      max-height="220"
      :row-key="(r: { material: MaterialDto }) => r.material.id"
    >
      <el-table-column :label="t('inquiries.lines.fields.materialCode')" width="140">
        <template #default="{ row }">{{ row.material.code }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.name')" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ pickName(row.material, locale) }}</template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.quantity')" width="220">
        <template #default="{ row }">
          <el-input
            v-model="row.quantity"
            size="small"
            maxlength="20"
            :placeholder="t('inquiries.lines.quantityHint')"
            :class="{ 'is-error': row.error }"
            @input="row.error = false"
          />
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.unit')" width="80">
        <template #default="{ row }"><DictTag type="unit" :code="row.material.unitCode" plain /></template>
      </el-table-column>
      <el-table-column width="80">
        <template #default="{ row }">
          <el-button link type="danger" @click="toggle(row.material, false)">{{
            t('inquiries.picker.remove')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="picked.length === 0" @click="confirm">
        {{ t('inquiries.picker.add') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.picker {
  display: flex;
  gap: 16px;
}
.tree {
  flex: 0 0 220px;
  max-height: 380px;
  overflow-y: auto;
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 8px;
}
.main {
  flex: 1;
  min-width: 0;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.picked-title {
  margin: 16px 0 8px;
  font-weight: 600;
}
.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
