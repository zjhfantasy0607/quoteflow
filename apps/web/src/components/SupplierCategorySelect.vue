<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSupplierCategoryStore } from '@/stores/supplierCategories';
import { pickName } from '@/utils/format';

/**
 * 供应商分类下拉（R04-1）。默认只能选启用的分类，当前值即使已停用也照常显示；
 * 用作列表筛选时传 allow-disabled（可多选），停用的分类也能选。
 */
const props = withDefaults(
  defineProps<{ multiple?: boolean; allowDisabled?: boolean; placeholder?: string; clearable?: boolean }>(),
  { multiple: false, allowDisabled: false, placeholder: undefined, clearable: true },
);
const model = defineModel<string | string[] | null | undefined>();

const { t, locale } = useI18n();
const store = useSupplierCategoryStore();

const selected = computed(
  () => new Set(Array.isArray(model.value) ? model.value : model.value ? [model.value] : []),
);
const options = computed(() =>
  (store.items ?? [])
    .filter((c) => props.allowDisabled || c.status === 'ENABLED' || selected.value.has(c.code))
    .map((c) => ({
      value: c.code,
      label: pickName(c, locale.value),
      off: c.status === 'DISABLED',
      disabled: !props.allowDisabled && c.status === 'DISABLED',
    })),
);

// 加载失败的提示由 http 拦截器显示
onMounted(() => void store.load().catch(() => undefined));
</script>

<template>
  <el-select
    v-model="model"
    :multiple="multiple"
    :placeholder="placeholder"
    :clearable="clearable"
    collapse-tags
    collapse-tags-tooltip
    filterable
    style="width: 100%"
  >
    <el-option v-for="o in options" :key="o.value" :value="o.value" :label="o.label" :disabled="o.disabled">
      <span :class="{ off: o.off }">{{ o.label }}</span>
      <span v-if="o.off" class="off-tag">{{ t('suppliers.categories.disabledTag') }}</span>
    </el-option>
  </el-select>
</template>

<style scoped>
.off {
  color: var(--el-text-color-placeholder);
}
.off-tag {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
