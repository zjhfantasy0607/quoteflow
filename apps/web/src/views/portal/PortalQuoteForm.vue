<script setup lang="ts">
import type {
  FileDto,
  ImportResultDto,
  Locale,
  PortalQuoteDetailDto,
  PplValueError,
  QuoteFormParams,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { portalApi } from '@/api/portal';
import ExcelImportDialog from '@/components/ExcelImportDialog.vue';
import FileUploader from '@/components/FileUploader.vue';
import PplLineTable from '@/components/PplLineTable.vue';
import { useDictStore } from '@/stores/dict';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import { remainingText } from '@/utils/inquiries';
import {
  defaultValues,
  dictLookup,
  errorMap,
  sheetLines,
  sheetTotal,
  supplierValues,
  validateSheet,
  type PplErrorMap,
  type PplRawValues,
} from '@/utils/ppl';
import DeclineQuoteDialog from './DeclineQuoteDialog.vue';

/**
 * 门户报价详情的"我的报价"区（M09 §5，参考 PPT #6、#9）：在线填写（PplLineTable + PplForm 抽屉）或锁定 Excel
 * 下载导入；实时合计；备注、变更说明、附件；保存草稿、提交、拒绝按 allowedActions 显示。
 * 截止后（或作废）只读显示最后一次提交的版本
 */
const props = defineProps<{ detail: PortalQuoteDetailDto }>();
const emit = defineEmits<{ changed: [PortalQuoteDetailDto] }>();

const { t, locale } = useI18n();
const dict = useDictStore();

const columns = computed(() => props.detail.template.columns);
const lines = computed(() =>
  sheetLines(
    props.detail.lines,
    columns.value,
    props.detail.inquiry.currency,
    locale.value as Locale,
    (code) => dict.find('unit', code),
  ),
);
/** 单位、拒绝原因的名称，和枚举列的选项（提交前校验要用） */
const dictTypes = computed(() => [
  'unit',
  'decline_reason',
  ...new Set(columns.value.filter((c) => c.dictType).map((c) => c.dictType!)),
]);
const can = (action: PortalQuoteDetailDto['allowedActions'][number]) =>
  props.detail.allowedActions.includes(action);
const editable = computed(() => can('saveDraft'));
const currency = computed(() => props.detail.inquiry.currency);

const values = ref<Record<string, PplRawValues>>({});
const remark = ref('');
const changeNote = ref('');
const attachments = ref<FileDto[]>([]);
const errors = ref<PplErrorMap>({});
const saving = ref<'draft' | 'submit' | null>(null);
const importVisible = ref(false);
const declineVisible = ref(false);
const table = ref<InstanceType<typeof PplLineTable> | null>(null);

/**
 * 表单初值：草稿 → 当前版本（备注和附件沿用上一版，变更说明每次重写）→ 列的默认值（R09-3）。
 * 取值复制一份再编辑；detail 是响应式代理，structuredClone 要先 toRaw
 */
function reset(): void {
  const { draft, currentVersion } = props.detail;
  if (draft) {
    values.value = structuredClone(toRaw(draft.lines));
    remark.value = draft.remark ?? '';
    changeNote.value = draft.changeNote ?? '';
    attachments.value = [...draft.attachments];
  } else if (currentVersion) {
    values.value = Object.fromEntries(
      toRaw(currentVersion.lines).map((l) => [
        l.lineId,
        structuredClone(supplierValues(columns.value, l.values)),
      ]),
    );
    remark.value = currentVersion.remark ?? '';
    changeNote.value = '';
    attachments.value = [...currentVersion.attachments];
  } else {
    values.value = defaultValues(columns.value, lines.value);
    remark.value = '';
    changeNote.value = '';
    attachments.value = [];
  }
  errors.value = {};
}
watch(() => props.detail, reset, { immediate: true });

/** 只读时显示的版本取值（版本里存的，含公式列） */
const versionValues = computed<Record<string, PplRawValues>>(() =>
  Object.fromEntries((props.detail.currentVersion?.lines ?? []).map((l) => [l.lineId, l.values])),
);
const total = computed(() =>
  editable.value
    ? sheetTotal(columns.value, lines.value, values.value)
    : props.detail.currentVersion?.totalAmount,
);

// 倒计时每 30 秒刷新一次
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 30_000);
  void dict.load(dictTypes.value);
});
onBeforeUnmount(() => window.clearInterval(timer));
const left = computed(() =>
  props.detail.round.deadline ? remainingText(props.detail.round.deadline, now.value) : null,
);

/** 已拒绝：拒绝时间和原因（原因放在最后，供应商写的说明结尾自带标点） */
const declined = computed(() => {
  const d = props.detail;
  if (d.status !== 'DECLINED' || !d.declinedAt) return null;
  const item = dict.find('decline_reason', d.declineReasonCode);
  const reason = [item ? pickName(item, locale.value) : d.declineReasonCode, d.declineReason]
    .filter(Boolean)
    .join(' · ');
  const time = `${formatDateTime(d.declinedAt)} ${t('common.tz')}`;
  return {
    title: t(editable.value ? 'portal.form.declined' : 'portal.form.declinedClosed', { time }),
    reason: t('portal.form.declinedReason', { reason }),
  };
});
const draftText = computed(() => {
  const draft = props.detail.draft;
  if (!draft) return '';
  const time = formatDateTime(draft.updatedAt);
  return draft.source === 'EXCEL'
    ? t('portal.form.draftFromExcel', { time })
    : t('portal.form.draftSavedAt', { time });
});
const readonlyText = computed(() =>
  props.detail.status === 'VOID' ? t('portal.form.readonlyVoid') : t('portal.form.readonly'),
);

function body(): QuoteFormParams {
  return {
    lines: values.value,
    remark: remark.value,
    changeNote: changeNote.value,
    attachmentFileIds: attachments.value.map((f) => f.id),
  };
}

/** R09-11：错误按行号、列顺序，定位到第一处（打开那一行的抽屉并滚动到该字段） */
function showErrors(list: PplValueError[]): void {
  errors.value = errorMap(list);
  ElMessage.error(t('portal.form.invalid', { count: list.length }));
  const first = list[0];
  if (first) table.value?.open(first.lineId, first.key);
}

/** 前端先做与后端相同的校验（草稿只校验格式） */
async function check(mode: 'draft' | 'submit'): Promise<boolean> {
  await dict.load(dictTypes.value);
  const list = validateSheet(
    columns.value,
    lines.value,
    values.value,
    dictLookup(columns.value, dict.items),
    mode,
  );
  if (list.length > 0) {
    showErrors(list);
    return false;
  }
  errors.value = {};
  return true;
}

function failed(err: unknown): void {
  const res = apiError(err);
  if (res?.code === 'QUOTE_VALUES_INVALID' && Array.isArray(res.details))
    showErrors(res.details as PplValueError[]);
  else ElMessage.error(translateError(res));
}

async function saveDraft(): Promise<void> {
  if (!(await check('draft'))) return;
  saving.value = 'draft';
  try {
    const detail = await portalApi.saveDraft(props.detail.id, body());
    ElMessage.success(t('portal.form.draftSaved'));
    emit('changed', detail);
  } catch (err) {
    failed(err);
  } finally {
    saving.value = null;
  }
}

async function submit(): Promise<void> {
  if (!(await check('submit'))) return;
  const no = props.detail.versionCount + 1;
  if (!(await confirmAction(t('portal.form.submitConfirm', { no }), { type: 'info' }))) return;
  saving.value = 'submit';
  try {
    const detail = await portalApi.submit(props.detail.id, body());
    ElMessage.success(t('portal.form.submitted', { no: detail.currentVersion?.versionNo ?? no }));
    emit('changed', detail);
  } catch (err) {
    failed(err);
  } finally {
    saving.value = null;
  }
}

/** ExcelImportDialog 要的是"新增 / 更新条数"，这里换成导入后的详情，提示语另给 */
let imported: PortalQuoteDetailDto | null = null;
async function importExcel(file: File): Promise<ImportResultDto> {
  imported = await portalApi.importExcel(props.detail.id, file);
  return { created: 0, updated: imported.lines.length };
}
function onImported(): void {
  if (imported) emit('changed', imported);
  imported = null;
}
</script>

<template>
  <el-card shadow="never" class="qf-card quote-form">
    <template #header>
      <div class="header">
        <span class="section-title">{{ t('portal.form.title') }}</span>
        <span v-if="detail.currentVersion" class="muted">
          {{
            t('portal.form.current', {
              no: detail.currentVersion.versionNo,
              time: `${formatDateTime(detail.currentVersion.submittedAt)} ${t('common.tz')}`,
            })
          }}
        </span>
      </div>
    </template>

    <template v-if="editable">
      <el-alert type="info" show-icon :closable="false" class="block">
        <template #title>
          <strong>{{ t('portal.form.hint') }}</strong>
          <span v-if="left" class="countdown">{{ t('portal.form.countdown', { time: left }) }}</span>
        </template>
        <div>{{ t('portal.form.ways') }}</div>
      </el-alert>
      <el-alert
        v-if="declined"
        type="warning"
        :title="declined.title"
        :description="declined.reason"
        show-icon
        :closable="false"
        class="block"
      />

      <div class="toolbar">
        <el-button
          v-if="can('downloadTemplate')"
          icon="Download"
          tag="a"
          :href="portalApi.excelTemplateUrl(detail.id)"
        >
          {{ t('portal.form.downloadTemplate') }}
        </el-button>
        <el-button v-if="can('importExcel')" icon="Upload" @click="importVisible = true">
          {{ t('portal.form.importExcel') }}
        </el-button>
        <span v-if="draftText" class="muted draft">{{ draftText }}</span>
      </div>

      <PplLineTable
        ref="table"
        v-model:values="values"
        :groups="detail.template.groups"
        :columns="columns"
        :lines="lines"
        :currency="currency"
        :errors="errors"
      />
      <div class="total">
        {{ t('portal.form.totalLabel') }}<strong>{{ currency }} {{ formatMoney(total ?? '0', 2) }}</strong>
      </div>

      <el-form label-position="top" class="extra">
        <div class="extra-grid">
          <el-form-item :label="t('portal.form.remark')">
            <el-input
              v-model="remark"
              type="textarea"
              :rows="3"
              maxlength="1000"
              show-word-limit
              :placeholder="t('portal.form.remarkPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="t('portal.form.changeNote')">
            <el-input
              v-model="changeNote"
              type="textarea"
              :rows="3"
              maxlength="1000"
              show-word-limit
              :placeholder="t('portal.form.changeNotePlaceholder')"
            />
          </el-form-item>
        </div>
        <el-form-item :label="t('portal.form.attachments')">
          <FileUploader v-model="attachments" kind="ATTACHMENT" :limit="10" />
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button v-if="can('decline')" type="danger" plain @click="declineVisible = true">
          {{ t('portal.form.decline') }}
        </el-button>
        <el-button :loading="saving === 'draft'" :disabled="saving !== null" @click="saveDraft">
          {{ t('portal.form.saveDraft') }}
        </el-button>
        <el-button type="primary" :loading="saving === 'submit'" :disabled="saving !== null" @click="submit">
          {{ detail.currentVersion ? t('portal.form.resubmit') : t('portal.form.submit') }}
        </el-button>
      </div>
    </template>

    <template v-else>
      <template v-if="detail.currentVersion">
        <el-alert :title="readonlyText" type="info" show-icon :closable="false" class="block" />
        <PplLineTable
          :values="versionValues"
          :groups="detail.template.groups"
          :columns="columns"
          :lines="lines"
          :currency="detail.currentVersion.currency"
          readonly
        />
        <div class="total">
          {{ t('portal.form.totalLabel')
          }}<strong>{{ detail.currentVersion.currency }} {{ formatMoney(total ?? '0', 2) }}</strong>
        </div>
      </template>
      <el-empty v-else :image-size="80">
        <template #description>
          <template v-if="declined">
            <div>{{ declined.title }}</div>
            <div>{{ declined.reason }}</div>
          </template>
          <span v-else>{{ t('portal.form.noQuote') }}</span>
        </template>
      </el-empty>
    </template>

    <ExcelImportDialog
      v-model="importVisible"
      :title="t('portal.form.importTitle')"
      :template-url="portalApi.excelTemplateUrl(detail.id)"
      :upload="importExcel"
      :success-message="() => t('portal.form.imported')"
      @imported="onImported"
    />
    <DeclineQuoteDialog
      v-model="declineVisible"
      :quote-id="detail.id"
      :submitted="detail.status === 'SUBMITTED'"
      @declined="emit('changed', $event)"
    />
  </el-card>
</template>

<style scoped>
.header {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.section-title {
  font-weight: 600;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.block {
  margin-bottom: 12px;
}
.countdown {
  margin-left: 12px;
  color: var(--el-color-warning-dark-2);
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar .draft {
  margin-left: 8px;
}
a.el-button {
  text-decoration: none;
}
.total {
  margin-top: 12px;
  font-size: 15px;
  text-align: right;
}
.total strong {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.extra {
  margin-top: 8px;
}
.extra-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
