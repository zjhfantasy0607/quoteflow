<script setup lang="ts">
import type { PplGroup, PplResolvedColumn, PplValueError } from '@quoteflow/shared';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pickLabel } from '@/utils/format';
import { liveRow, pplErrorText, type PplRawValues, type PplSheetLine } from '@/utils/ppl';
import PplValueDisplay from './PplValueDisplay.vue';
import PplValueInput from './PplValueInput.vue';

/**
 * 一个报价行的全部字段（M09 §5 PplForm 抽屉）：按分组折叠显示该轮冻结模板的所有列；预填列只读、取自询价行，
 * 公式列只读、实时计算，必填列标 *（R09-2）。focusKey：打开时展开它所在的分组并滚动到它（R09-11）
 */
const props = defineProps<{
  groups: readonly PplGroup[];
  columns: readonly PplResolvedColumn[];
  line: PplSheetLine | null;
  readonly?: boolean;
  currency: string;
  errors?: Record<string, PplValueError>;
  maskedFields?: readonly string[];
  focusKey?: string | null;
}>();
const visible = defineModel<boolean>({ required: true });
/** 这一行的取值：编辑时是供应商填写的原始值，只读时是版本里存的值（含公式列） */
const values = defineModel<PplRawValues>('values', { default: () => ({}) });

const { t, locale } = useI18n();
const body = ref<HTMLElement | null>(null);
const opened = ref<string[]>([]);

const sections = computed(() =>
  props.groups
    .map((g) => ({
      key: g.key,
      label: pickLabel(g, locale.value),
      columns: props.columns.filter((c) => c.group === g.key),
    }))
    .filter((s) => s.columns.length > 0),
);
const display = computed(() => {
  if (!props.line) return {};
  return props.readonly
    ? { ...values.value, ...props.line.prefill }
    : liveRow(props.columns, props.line, values.value);
});
const title = computed(() => {
  if (!props.line) return '';
  const name = props.line.prefill.material_name;
  return t('ppl.form.title', { no: props.line.lineNo, name: name === undefined ? '' : String(name) });
});
const errorCount = computed(() => Object.keys(props.errors ?? {}).length);

function update(key: string, value: unknown): void {
  const next = { ...values.value };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  values.value = next;
}

watch(visible, async (open) => {
  if (!open) return;
  const focus = props.focusKey ? props.columns.find((c) => c.key === props.focusKey) : undefined;
  opened.value = sections.value.map((s) => s.key);
  if (!focus) return;
  await nextTick();
  // 抽屉打开动画结束前元素已经在 DOM 里，滚动到出错的字段并聚焦它的输入框
  const el = body.value?.querySelector<HTMLElement>(`[data-field="${focus.key}"]`);
  el?.scrollIntoView({ block: 'center' });
  el?.querySelector<HTMLElement>('input, textarea')?.focus();
});
</script>

<template>
  <el-drawer v-model="visible" :title="title" size="640px" append-to-body destroy-on-close class="ppl-form">
    <div ref="body">
      <el-alert
        v-if="errorCount > 0"
        type="error"
        :title="t('ppl.form.errors', { count: errorCount })"
        show-icon
        :closable="false"
        class="errors"
      />
      <el-collapse v-model="opened">
        <el-collapse-item
          v-for="section in sections"
          :key="section.key"
          :name="section.key"
          :title="section.label"
        >
          <div
            v-for="column in section.columns"
            :key="column.key"
            :data-field="column.key"
            :class="['field', { 'is-error': errors?.[column.key] }]"
          >
            <div class="label">
              <span v-if="column.required" class="required">*</span>
              {{ pickLabel(column, locale) }}
              <el-tag v-if="column.source === 'prefill'" size="small" type="info" disable-transitions>
                {{ t('ppl.form.prefill') }}
              </el-tag>
              <el-tag v-else-if="column.source === 'formula'" size="small" disable-transitions>
                {{ t('ppl.form.formula') }}
              </el-tag>
            </div>
            <div class="control">
              <PplValueInput
                v-if="!readonly && column.source === 'supplier'"
                :model-value="values[column.key]"
                :column="column"
                :currency="currency"
                :invalid="!!errors?.[column.key]"
                @update:model-value="update(column.key, $event)"
              />
              <PplValueDisplay
                v-else
                :column="column"
                :value="display[column.key]"
                :masked="maskedFields?.includes(column.key)"
              />
              <div v-if="errors?.[column.key]" class="error">{{ pplErrorText(errors[column.key]) }}</div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
    <template #footer>
      <el-button type="primary" @click="visible = false">{{ t('ppl.form.done') }}</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.errors {
  margin-bottom: 12px;
}
.field {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  align-items: start;
  padding: 6px 0;
}
.label {
  padding-top: 6px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}
.label .el-tag {
  margin-left: 4px;
}
.required {
  color: var(--el-color-danger);
}
.control {
  min-height: 32px;
  padding-top: 0;
}
.field:not(:has(.ppl-input)) .control {
  padding-top: 6px;
}
.error {
  margin-top: 2px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}
</style>
