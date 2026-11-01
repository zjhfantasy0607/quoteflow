<script setup lang="ts">
import type { ReportFilterOptionsDto, RoundStatus } from '@quoteflow/shared';
import { useI18n } from 'vue-i18n';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import { pickName } from '@/utils/format';
import type { QuoteReportFilter } from '@/utils/reports';

/** 询报价单统计、物流报价明细共用的筛选栏（M15 §4） */
defineProps<{ options: ReportFilterOptionsDto; statuses: RoundStatus[] }>();
const model = defineModel<QuoteReportFilter>({ required: true });
const emit = defineEmits<{ search: []; reset: [] }>();
const { t, locale } = useI18n();
</script>

<template>
  <el-form inline class="report-filters" @submit.prevent="emit('search')">
    <el-form-item>
      <el-input
        v-model="model.inquiryNo"
        :placeholder="t('reports.filters.inquiryNo')"
        prefix-icon="Search"
        clearable
        style="width: 170px"
      />
    </el-form-item>
    <el-form-item>
      <el-select
        v-model="model.roundStatus"
        clearable
        :placeholder="t('reports.filters.status')"
        style="width: 140px"
      >
        <el-option v-for="s in statuses" :key="s" :value="s" :label="t(`enums.RoundStatus.${s}`)" />
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-date-picker
        v-model="model.range"
        type="daterange"
        value-format="YYYY-MM-DD"
        :start-placeholder="t('reports.filters.publishedFrom')"
        :end-placeholder="t('reports.filters.publishedTo')"
        style="width: 250px"
      />
    </el-form-item>
    <el-form-item>
      <el-select
        v-model="model.supplierId"
        filterable
        clearable
        :placeholder="t('reports.filters.supplier')"
        style="width: 200px"
      >
        <el-option
          v-for="s in options.suppliers"
          :key="s.id"
          :value="s.id"
          :label="`${s.code} ${pickName(s, locale)}`"
        />
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-select
        v-model="model.ownerId"
        filterable
        clearable
        :placeholder="t('reports.filters.owner')"
        style="width: 140px"
      >
        <el-option v-for="u in options.owners" :key="u.id" :value="u.id" :label="u.name" />
      </el-select>
    </el-form-item>
    <el-form-item>
      <CategoryTreeSelect
        v-model="model.materialCategoryId"
        allow-disabled
        :placeholder="t('reports.filters.materialCategory')"
        style="width: 180px"
      />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" native-type="submit" icon="Search">{{
        t('common.actions.search')
      }}</el-button>
      <el-button icon="Refresh" @click="emit('reset')">{{ t('common.actions.reset') }}</el-button>
    </el-form-item>
  </el-form>
</template>
