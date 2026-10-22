<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSupplierCategoryStore } from '@/stores/supplierCategories';
import { pickName } from '@/utils/format';

/** 供应商分类标签：预置的战略 / 优秀 / 普通用固定颜色，自定义分类用主色；停用的分类也显示名称 */
const props = defineProps<{ code: string }>();

const COLORS: Record<string, 'warning' | 'success' | 'info'> = {
  STRATEGIC: 'warning',
  EXCELLENT: 'success',
  NORMAL: 'info',
};

const { locale } = useI18n();
const store = useSupplierCategoryStore();
const item = computed(() => store.find(props.code));
const label = computed(() => (item.value ? pickName(item.value, locale.value) : props.code));

// 加载失败的提示由 http 拦截器显示
onMounted(() => void store.load().catch(() => undefined));
</script>

<template>
  <el-tag :type="COLORS[code] ?? 'primary'" :class="{ off: item?.status === 'DISABLED' }" disable-transitions>
    {{ label }}
  </el-tag>
</template>

<style scoped>
.off {
  text-decoration: line-through;
}
</style>
