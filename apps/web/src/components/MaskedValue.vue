<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 被脱敏（没有字段权限）或密封的字段显示为 🔒 ******（docs/01 §5.4、03 §2）；
 * 没被脱敏时显示默认插槽里的内容。
 */
defineProps<{ masked: boolean }>();
const { t } = useI18n();
</script>

<template>
  <el-tooltip v-if="masked" :content="t('common.masked')" placement="top">
    <span class="masked-value">
      <el-icon><Lock /></el-icon>
      <span>******</span>
    </span>
  </el-tooltip>
  <slot v-else />
</template>

<style scoped>
.masked-value {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--el-text-color-placeholder);
  letter-spacing: 1px;
  cursor: default;
}
</style>
