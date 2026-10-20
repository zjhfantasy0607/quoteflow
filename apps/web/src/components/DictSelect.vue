<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDictStore } from '@/stores/dict';
import { pickName } from '@/utils/format';

const props = withDefaults(
  defineProps<{ type: string; multiple?: boolean; placeholder?: string; clearable?: boolean; disabled?: boolean }>(),
  { multiple: false, placeholder: undefined, clearable: true, disabled: false },
);
const model = defineModel<string | string[] | null | undefined>();

const { locale } = useI18n();
const dict = useDictStore();
const options = computed(() =>
  dict.items(props.type).map((item) => ({ value: item.code, label: pickName(item, locale.value) })),
);

onMounted(() => void dict.load([props.type]));
</script>

<template>
  <el-select
    v-model="model"
    :multiple="multiple"
    :placeholder="placeholder"
    :clearable="clearable"
    :disabled="disabled"
    filterable
    style="width: 100%"
  >
    <el-option v-for="o in options" :key="o.value" :value="o.value" :label="o.label" />
  </el-select>
</template>
