<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDictStore } from '@/stores/dict';
import { pickName } from '@/utils/format';

const props = defineProps<{ type: string; code: string | null | undefined; plain?: boolean }>();

const { locale } = useI18n();
const dict = useDictStore();
const label = computed(() => {
  const item = dict.find(props.type, props.code);
  return item ? pickName(item, locale.value) : (props.code ?? '');
});

onMounted(() => void dict.load([props.type]));
</script>

<template>
  <template v-if="code">
    <span v-if="plain">{{ label }}</span>
    <el-tag v-else type="info" disable-transitions>{{ label }}</el-tag>
  </template>
</template>
