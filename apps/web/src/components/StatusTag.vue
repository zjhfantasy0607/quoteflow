<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ enumName: string; value: string }>();
const { t } = useI18n();

type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'info';

const SUCCESS = new Set(['WON', 'APPROVED', 'EVALUATED', 'SENT', 'ENABLED', 'ACTIVE', 'AGREED', 'SUBMITTED']);
const WARNING = new Set([
  'PENDING_APPROVAL',
  'PENDING_REVIEW',
  'PENDING_ACTIVATION',
  'WAITING_QUOTES',
  'QUOTES_CLOSED',
  'PENDING',
  'READY',
]);
const DANGER = new Set(['DECLINED', 'FAILED', 'DISABLED', 'CANCELLED', 'LOST']);
const PRIMARY = new Set(['OPENED', 'EVALUATING', 'OPEN', 'INVITED']);

const type = computed<TagType>(() => {
  if (SUCCESS.has(props.value)) return 'success';
  if (WARNING.has(props.value)) return 'warning';
  if (DANGER.has(props.value)) return 'danger';
  if (PRIMARY.has(props.value)) return 'primary';
  return 'info';
});
</script>

<template>
  <el-tag :type="type" disable-transitions>{{ t(`enums.${enumName}.${value}`) }}</el-tag>
</template>
