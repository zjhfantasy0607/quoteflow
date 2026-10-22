<script setup lang="ts">
import type { MaterialCategoryNodeDto } from '@quoteflow/shared';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCategoryStore } from '@/stores/categories';
import { categoryMatches } from '@/utils/categories';
import { pickName } from '@/utils/format';

/**
 * 材料分类树形下拉（M03，M04 供应商主营分类、M06 询价行复用）。
 * 默认只能选有效启用的节点，停用的置灰（R03-2）；当前值即使已停用也照常显示。
 * 用作列表筛选时传 allow-disabled，停用的分类也能选。multiple 时可勾选多个（供应商主营分类，R04-4），
 * 上下级各自独立勾选；已选的停用分类可以去掉，但不能再勾上。
 */
const props = withDefaults(
  defineProps<{
    allowDisabled?: boolean;
    multiple?: boolean;
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
  }>(),
  { allowDisabled: false, multiple: false, placeholder: undefined, clearable: true, disabled: false },
);
const model = defineModel<string | string[] | null | undefined>();

const { locale } = useI18n();
const store = useCategoryStore();

interface CategoryOption {
  value: string;
  label: string;
  code: string;
  nameZh: string;
  nameEn: string;
  off: boolean;
  disabled: boolean;
  children: CategoryOption[];
}

const options = computed<CategoryOption[]>(() => {
  const toOptions = (nodes: MaterialCategoryNodeDto[]): CategoryOption[] =>
    nodes.map((n) => ({
      value: n.id,
      label: pickName(n, locale.value),
      code: n.code,
      nameZh: n.nameZh,
      nameEn: n.nameEn,
      off: !n.effectiveEnabled,
      disabled: !props.allowDisabled && !n.effectiveEnabled,
      children: toOptions(n.children),
    }));
  return toOptions(store.tree ?? []);
});

function filterNode(keyword: string, data: Record<string, unknown>): boolean {
  return categoryMatches(keyword, data as unknown as CategoryOption);
}

// 加载失败的提示由 http 拦截器显示
onMounted(() => void store.load().catch(() => undefined));
</script>

<template>
  <el-tree-select
    v-model="model"
    :data="options"
    node-key="value"
    :props="{ label: 'label', children: 'children', disabled: 'disabled' }"
    :multiple="multiple"
    :show-checkbox="multiple"
    :check-on-click-node="multiple"
    check-strictly
    filterable
    default-expand-all
    :expand-on-click-node="false"
    :filter-node-method="filterNode"
    :render-after-expand="false"
    :placeholder="placeholder"
    :clearable="clearable"
    :disabled="disabled"
    class="category-tree-select"
  >
    <template #default="{ data }">
      <span :class="['category-option', { off: data.off }]">
        <span>{{ data.label }}</span>
        <span class="code">{{ data.code }}</span>
      </span>
    </template>
  </el-tree-select>
</template>

<style scoped>
.category-tree-select {
  width: 100%;
}
.category-option {
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
}
.category-option.off {
  color: var(--el-text-color-placeholder);
}
.code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
