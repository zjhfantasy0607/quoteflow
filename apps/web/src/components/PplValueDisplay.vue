<script setup lang="ts">
import type { PplColumn } from '@quoteflow/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDictStore } from '@/stores/dict';
import { formatMoney, pickName } from '@/utils/format';
import MaskedValue from './MaskedValue.vue';

/**
 * PPL 取值的只读显示（04 §5）：金额千分位、百分比、是否、字典选项按当前语言；被脱敏的显示 🔒（03 §2）。
 * 报价表格、抽屉表单、版本明细共用，后面比价矩阵、合同快照也用它
 */
const props = defineProps<{
  column: Pick<PplColumn, 'type' | 'dictType' | 'precision'>;
  value: unknown;
  masked?: boolean;
}>();

const { t, locale } = useI18n();
const dict = useDictStore();

const empty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v === '') ||
  (Array.isArray(v) && v.length === 0);

const optionName = (code: string) => {
  const item = dict.find(props.column.dictType ?? '', code);
  return item ? pickName(item, locale.value) : code;
};

const text = computed(() => {
  const v = props.value;
  if (empty(v)) return '';
  switch (props.column.type) {
    case 'money':
      return formatMoney(String(v));
    case 'percent':
      return `${String(v)}%`;
    case 'bool':
      return v === true ? t('ppl.bool.yes') : v === false ? t('ppl.bool.no') : String(v);
    case 'enum':
      return optionName(String(v));
    case 'multiEnum':
      return Array.isArray(v)
        ? v.map((c) => optionName(String(c))).join(t('common.listSeparator'))
        : String(v);
    default:
      return String(v);
  }
});
</script>

<template>
  <MaskedValue :masked="!!masked">
    <span v-if="text" :class="['ppl-value', `ppl-value--${column.type}`]">{{ text }}</span>
    <span v-else class="ppl-empty">—</span>
  </MaskedValue>
</template>

<style scoped>
.ppl-value--textarea {
  white-space: pre-wrap;
}
.ppl-value--money,
.ppl-value--decimal,
.ppl-value--percent,
.ppl-value--int {
  font-variant-numeric: tabular-nums;
}
.ppl-empty {
  color: var(--el-text-color-placeholder);
}
</style>
