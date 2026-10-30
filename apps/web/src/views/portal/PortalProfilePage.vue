<script setup lang="ts">
import type { SupplierProfileDto } from '@quoteflow/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import PageHeader from '@/components/PageHeader.vue';
import { pickName } from '@/utils/format';
import { supplierLanguageLabel } from '@/utils/suppliers';

/** 企业资料（只读，M08）：由采购方维护 */
const { t, locale } = useI18n();
const profile = ref<SupplierProfileDto | null>(null);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    profile.value = await portalApi.profile();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading">
    <PageHeader :title="t('portal.profile.title')" :subtitle="t('portal.profile.subtitle')" />
    <el-card v-if="profile" shadow="never" class="qf-card">
      <el-descriptions :column="2" border>
        <el-descriptions-item :label="t('portal.profile.fields.nameZh')">{{
          profile.nameZh
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.nameEn')">
          {{ profile.nameEn ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.code')">{{
          profile.code
        }}</el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.creditCode')">
          {{ profile.creditCode ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.materialCategories')" :span="2">
          {{
            profile.materialCategories.map((c) => pickName(c, locale)).join(t('common.listSeparator')) || '—'
          }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.contactName')">
          {{ profile.contactName }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.contactPhone')">
          {{ profile.contactPhone ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.contactEmail')">
          {{ profile.contactEmail }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.ccEmails')">
          {{ profile.ccEmails.join(t('common.listSeparator')) || '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.language')">
          {{ supplierLanguageLabel(profile.preferredLanguage) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.country')">
          {{ profile.country ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('portal.profile.fields.address')" :span="2">
          {{ profile.address ?? '—' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>
