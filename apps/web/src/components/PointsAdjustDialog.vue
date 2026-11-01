<script setup lang="ts">
import {
  POINTS_ADJUST_MAX,
  pointsAdjustSchema,
  type PointsLedgerItemDto,
  type ReportFilterOptionsDto,
  type ReportSupplierDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { reportsApi } from '@/api/reports';
import { pickName } from '@/utils/format';
import { zodErrors, type FieldErrors } from '@/utils/validate';

/**
 * 手工调整积分（R15-3）：分值是非零整数（±1000 以内），备注必填。报表"积分记录流水"里选供应商；
 * 供应商详情里供应商固定（传 supplier）
 */
const props = defineProps<{
  supplier?: ReportSupplierDto;
  suppliers?: ReportFilterOptionsDto['suppliers'];
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ adjusted: [PointsLedgerItemDto] }>();

const { t, locale } = useI18n();
const form = reactive({ supplierId: '', delta: undefined as number | undefined, remark: '' });
const errors = ref<FieldErrors>({});
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  Object.assign(form, { supplierId: props.supplier?.id ?? '', delta: undefined, remark: '' });
  errors.value = {};
});

function validate(): boolean {
  const found = zodErrors(pointsAdjustSchema, { delta: form.delta, remark: form.remark });
  if (!form.supplierId) found.supplierId = t('common.validation.required');
  if (!found.remark && !form.remark.trim()) found.remark = t('errors.POINTS_REMARK_REQUIRED');
  errors.value = found;
  return Object.keys(found).length === 0;
}

async function confirm(): Promise<void> {
  if (!validate()) return;
  saving.value = true;
  try {
    const entry = await reportsApi.adjustPoints(form.supplierId, { delta: form.delta!, remark: form.remark });
    ElMessage.success(t('reports.adjust.done'));
    visible.value = false;
    emit('adjusted', entry);
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'POINTS_REMARK_REQUIRED') errors.value = { remark: translateError(body) };
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('reports.adjust.title')"
    width="480px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form label-position="top" @submit.prevent="confirm">
      <el-form-item :label="t('reports.adjust.supplier')" :error="errors.supplierId" required>
        <el-input v-if="supplier" :model-value="`${supplier.code} ${pickName(supplier, locale)}`" disabled />
        <el-select
          v-else
          v-model="form.supplierId"
          filterable
          :placeholder="t('reports.adjust.supplierPlaceholder')"
          style="width: 100%"
        >
          <el-option
            v-for="s in suppliers ?? []"
            :key="s.id"
            :value="s.id"
            :label="`${s.code} ${pickName(s, locale)}`"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('reports.adjust.delta')" :error="errors.delta" required>
        <el-input-number
          v-model="form.delta"
          :min="-POINTS_ADJUST_MAX"
          :max="POINTS_ADJUST_MAX"
          :step="1"
          :precision="0"
          style="width: 180px"
        />
        <div class="hint">{{ t('reports.adjust.deltaHint') }}</div>
      </el-form-item>
      <el-form-item :label="t('reports.adjust.remark')" :error="errors.remark" required>
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="t('reports.adjust.remarkPlaceholder')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">{{
        t('common.actions.confirm')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  width: 100%;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
