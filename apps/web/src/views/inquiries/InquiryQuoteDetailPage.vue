<script setup lang="ts">
import type {
  FileDto,
  InquiryDetailDto,
  InquiryRoundDto,
  Locale,
  RoundQuoteDetailDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import DictTag from '@/components/DictTag.vue';
import FilePreview from '@/components/FilePreview.vue';
import MaskedValue from '@/components/MaskedValue.vue';
import PageHeader from '@/components/PageHeader.vue';
import PplLineTable from '@/components/PplLineTable.vue';
import QuoteVersionHistory from '@/components/QuoteVersionHistory.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useDictStore } from '@/stores/dict';
import { formatDateTime, formatMoney, pickName } from '@/utils/format';
import { inquiryNo } from '@/utils/inquiries';
import { sheetLines } from '@/utils/ppl';

/**
 * 采购方查看某家供应商的报价（M10 §5，需要 inquiry:evaluate）：响应状态与时间、当前版本（只读 PplLineTable，
 * 没有 quote.amount 时金额列与合计显示 🔒）、报价附件、历史版本。开标前接口返回 QUOTE_SEALED，页面只提示不可查看
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const dict = useDictStore();

const id = computed(() => String(route.params.id));
const roundNo = computed(() => Number(route.params.roundNo));
const quoteId = computed(() => String(route.params.quoteId));

const inquiry = ref<InquiryDetailDto | null>(null);
const round = ref<InquiryRoundDto | null>(null);
const quote = ref<RoundQuoteDetailDto | null>(null);
const loading = ref(false);
/** 加载失败的原因：NOT_FOUND 或 QUOTE_SEALED（其余错误弹提示） */
const failure = ref<'NOT_FOUND' | 'QUOTE_SEALED' | null>(null);
const previewing = ref<FileDto | null>(null);

const current = computed(() => quote.value?.currentVersion ?? null);
const columns = computed(() => quote.value?.template.columns ?? []);
const lines = computed(() =>
  round.value && inquiry.value
    ? sheetLines(round.value.lines, columns.value, inquiry.value.currency, locale.value as Locale, (code) =>
        dict.find('unit', code),
      )
    : [],
);
const currentValues = computed(() =>
  Object.fromEntries((current.value?.lines ?? []).map((l) => [l.lineId, l.values])),
);
const totalMasked = computed(() => current.value?.maskedFields?.includes('totalAmount') ?? false);
const fetchVersion = (versionNo: number) =>
  inquiriesApi.quoteVersion(id.value, roundNo.value, quoteId.value, versionNo);
const time = (iso: string | null) => (iso ? `${formatDateTime(iso)} ${t('common.tz')}` : '—');

async function load(): Promise<void> {
  loading.value = true;
  failure.value = null;
  try {
    const [detail, r, q] = await Promise.all([
      inquiriesApi.get(id.value),
      inquiriesApi.round(id.value, roundNo.value),
      inquiriesApi.quote(id.value, roundNo.value, quoteId.value),
    ]);
    inquiry.value = detail;
    round.value = r;
    quote.value = q;
    const types = q.template.columns.filter((c) => c.dictType).map((c) => c.dictType!);
    void dict.load(['unit', ...new Set(types)]);
  } catch (err) {
    const code = apiError(err)?.code;
    if (code === 'NOT_FOUND' || code === 'QUOTE_SEALED') failure.value = code;
    else ElMessage.error(translateError(apiError(err)));
  } finally {
    loading.value = false;
  }
}

function back(): void {
  void router.push({ name: 'inquiry-detail', params: { id: id.value }, query: { tab: 'responses' } });
}

watch(
  [id, roundNo, quoteId],
  () => {
    inquiry.value = null;
    round.value = null;
    quote.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div v-loading="loading">
    <el-result
      v-if="failure"
      :icon="failure === 'QUOTE_SEALED' ? 'info' : 'warning'"
      :title="failure === 'QUOTE_SEALED' ? t('inquiries.quote.sealed') : t('common.page.notFound.title')"
    >
      <template #extra>
        <el-button @click="back">{{ t('inquiries.quote.back') }}</el-button>
      </template>
    </el-result>

    <template v-if="quote && inquiry">
      <PageHeader
        :title="`${quote.supplier.code} · ${pickName(quote.supplier, locale)}`"
        :subtitle="`${inquiryNo(inquiry)} · ${inquiry.title} · ${t('inquiries.roundNo', { no: roundNo })}`"
      >
        <template #actions>
          <el-button icon="Back" @click="back">{{ t('inquiries.quote.back') }}</el-button>
        </template>
      </PageHeader>

      <el-card shadow="never" class="qf-card section">
        <el-descriptions :column="3" border>
          <el-descriptions-item :label="t('inquiries.responses.fields.status')">
            <StatusTag enum-name="QuoteStatus" :value="quote.status" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.responses.fields.invitedAt')">
            {{ time(quote.invitedAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.responses.fields.firstViewedAt')">
            {{ time(quote.firstViewedAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.responses.fields.respondedAt')">
            {{ time(quote.respondedAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.quote.lastSubmittedAt')">
            {{ time(quote.lastSubmittedAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.responses.fields.versionCount')">
            {{ quote.versions.length }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="quote.status === 'DECLINED'"
            :label="t('inquiries.responses.fields.declineReason')"
            :span="3"
          >
            {{ time(quote.declinedAt) }}
            <DictTag v-if="quote.declineReasonCode" type="decline_reason" :code="quote.declineReasonCode" plain />
            <span v-if="quote.declineReason" class="reason pre">{{ quote.declineReason }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.quote.current') }}</span>
          <span v-if="current" class="muted">
            {{ t('ppl.versions.version', { no: current.versionNo }) }} ·
            {{ t(`enums.QuoteVersionSource.${current.source}`) }} · {{ time(current.submittedAt) }}
          </span>
        </template>
        <el-empty v-if="!current" :description="t('inquiries.quote.noVersion')" :image-size="64" />
        <template v-else>
          <el-alert
            v-if="quote.status === 'DECLINED'"
            type="warning"
            :title="t('inquiries.quote.declinedHint')"
            show-icon
            :closable="false"
            class="banner"
          />
          <el-descriptions :column="2" border class="meta">
            <el-descriptions-item :label="t('ppl.versions.totalLabel')">
              <MaskedValue :masked="totalMasked">
                <strong class="total">{{ current.currency }} {{ formatMoney(current.totalAmount ?? '', 2) }}</strong>
              </MaskedValue>
            </el-descriptions-item>
            <el-descriptions-item :label="t('ppl.versions.attachments')">
              <div v-for="f in current.attachments" :key="f.id">
                <el-button link type="primary" @click="previewing = f">{{ f.originalName }}</el-button>
              </div>
              <span v-if="current.attachments.length === 0">—</span>
            </el-descriptions-item>
            <el-descriptions-item :label="t('ppl.versions.remark')" :span="2">
              <span class="pre">{{ current.remark ?? '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="t('ppl.versions.changeNote')" :span="2">
              <span class="pre">{{ current.changeNote ?? '—' }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <PplLineTable
            :values="currentValues"
            :groups="quote.template.groups"
            :columns="columns"
            :lines="lines"
            :currency="current.currency"
            :masked-fields="current.maskedFields"
            readonly
          />
        </template>
      </el-card>

      <el-card v-if="quote.versions.length > 0" shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.quote.versions') }}</span>
        </template>
        <QuoteVersionHistory
          :versions="quote.versions"
          :current-no="current?.versionNo ?? null"
          :groups="quote.template.groups"
          :columns="columns"
          :lines="lines"
          :fetch-version="fetchVersion"
        />
      </el-card>

      <el-dialog
        :model-value="previewing !== null"
        :title="t('file.preview.title')"
        width="80%"
        top="5vh"
        append-to-body
        destroy-on-close
        @close="previewing = null"
      >
        <FilePreview v-if="previewing" :file="previewing" />
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.section,
.banner {
  margin-bottom: 16px;
}
.section-title {
  font-weight: 600;
}
.muted {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.meta {
  margin-bottom: 12px;
}
.total {
  font-variant-numeric: tabular-nums;
}
.reason {
  margin-left: 6px;
}
.pre {
  white-space: pre-wrap;
}
</style>
