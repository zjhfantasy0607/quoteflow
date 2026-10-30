<script setup lang="ts">
import { PPL_TEXT_MAX_LENGTH, type PplColumn } from '@quoteflow/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDecimalInput, formatIntInput } from '@/utils/ppl';
import DictSelect from './DictSelect.vue';

/**
 * 供应商填写列的输入控件（04 §5）：文本、多行文本、整数、小数 / 金额（前缀币种）/ 百分比（后缀 %）、日期、是否、单选、多选。
 * 值原样交给后端规范化；小数类失焦时补足位数，位数超了不四舍五入，由校验提示
 */
const props = defineProps<{
  column: Pick<PplColumn, 'key' | 'type' | 'dictType' | 'precision' | 'maxLength'>;
  currency?: string;
  invalid?: boolean;
  size?: 'small' | 'default';
}>();
const model = defineModel<unknown>();

const { t } = useI18n();

const text = computed({
  get: () => (model.value === undefined || model.value === null ? '' : String(model.value)),
  set: (v: string) => {
    model.value = v;
  },
});
const select = computed({
  get: () => model.value as string | string[] | null | undefined,
  set: (v) => {
    model.value = v ?? undefined;
  },
});
const flag = computed({
  get: () => model.value === true,
  set: (v: boolean) => {
    model.value = v;
  },
});
const date = computed({
  get: () => (typeof model.value === 'string' && model.value ? model.value : null),
  set: (v: string | null) => {
    model.value = v ?? undefined;
  },
});
const maxLength = computed(() =>
  props.column.type === 'text' || props.column.type === 'textarea'
    ? (props.column.maxLength ?? PPL_TEXT_MAX_LENGTH[props.column.type])
    : undefined,
);

/**
 * 失焦时按输入框里的文字格式化（不读 model：父组件还没重新渲染时它仍是上一次的值，
 * 同一时刻的输入和失焦会把刚输入的内容覆盖掉）；文字没变化就不更新
 */
function onBlur(event: FocusEvent): void {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target || typeof target.value !== 'string') return;
  const raw = target.value;
  let value: string | number;
  if (props.column.type === 'int') value = formatIntInput(raw);
  else if (['decimal', 'money', 'percent'].includes(props.column.type))
    value = formatDecimalInput(props.column, raw);
  else value = raw.trim();
  if (value !== raw) model.value = value;
}
</script>

<template>
  <div :class="['ppl-input', { 'is-invalid': invalid }]" :data-key="column.key">
    <el-input
      v-if="column.type === 'textarea'"
      v-model="text"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      :maxlength="maxLength"
      :size="size"
      @blur="onBlur"
    />
    <el-date-picker
      v-else-if="column.type === 'date'"
      v-model="date"
      type="date"
      value-format="YYYY-MM-DD"
      format="YYYY-MM-DD"
      :placeholder="t('ppl.datePlaceholder')"
      :size="size"
      style="width: 100%"
    />
    <el-switch
      v-else-if="column.type === 'bool'"
      v-model="flag"
      :active-text="t('ppl.bool.yes')"
      :inactive-text="t('ppl.bool.no')"
      inline-prompt
      :size="size"
    />
    <DictSelect
      v-else-if="column.type === 'enum' || column.type === 'multiEnum'"
      v-model="select"
      :type="column.dictType ?? ''"
      :multiple="column.type === 'multiEnum'"
      :placeholder="t('ppl.selectPlaceholder')"
    />
    <el-input
      v-else
      v-model="text"
      :maxlength="maxLength"
      :inputmode="column.type === 'text' ? undefined : 'decimal'"
      :size="size"
      @blur="onBlur"
    >
      <template v-if="column.type === 'money' && currency" #prefix>
        <span class="affix">{{ currency }}</span>
      </template>
      <template v-if="column.type === 'percent'" #suffix>%</template>
    </el-input>
  </div>
</template>

<style scoped>
.ppl-input {
  width: 100%;
}
.affix {
  margin-right: 4px;
  font-size: 12px;
}
.ppl-input.is-invalid :deep(.el-input__wrapper),
.ppl-input.is-invalid :deep(.el-textarea__inner),
.ppl-input.is-invalid :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
