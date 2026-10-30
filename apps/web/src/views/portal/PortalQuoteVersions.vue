<script setup lang="ts">
import type {
  FileDto,
  Locale,
  PortalQuoteDetailDto,
  QuoteVersionDto,
  QuoteVersionSummaryDto,
} from '@quoteflow/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import FilePreview from '@/components/FilePreview.vue';
import PplLineTable from '@/components/PplLineTable.vue';
import { useDictStore } from '@/stores/dict';
import { formatDateTime, formatMoney } from '@/utils/format';
import { portalSheetLines } from '@/utils/ppl';

/**
 * 门户的"历史版本"（R09-7，参考 PPT #9）：时间线（版本号、提交时间、含税合计、来源、备注），
 * 点开看只读的版本明细。作废的旧轮次照样能看（P-4）
 */
const props = defineProps<{ detail: PortalQuoteDetailDto }>();

const { t, locale } = useI18n();
const dict = useDictStore();

const versions = ref<QuoteVersionSummaryDto[]>([]);
const loading = ref(false);
const viewing = ref<QuoteVersionDto | null>(null);
const previewing = ref<FileDto | null>(null);

const columns = computed(() => props.detail.template.columns);
const lines = computed(() =>
  portalSheetLines(
    props.detail.lines,
    columns.value,
    props.detail.inquiry.currency,
    locale.value as Locale,
    (code) => dict.find('unit', code),
  ),
);
const viewingValues = computed(() =>
  Object.fromEntries((viewing.value?.lines ?? []).map((l) => [l.lineId, l.values])),
);
const currentNo = computed(() => props.detail.currentVersion?.versionNo ?? null);

async function load(): Promise<void> {
  if (props.detail.versionCount === 0) {
    versions.value = [];
    return;
  }
  loading.value = true;
  try {
    versions.value = await portalApi.versions(props.detail.id);
  } finally {
    loading.value = false;
  }
}

async function view(versionNo: number): Promise<void> {
  viewing.value = await portalApi.version(props.detail.id, versionNo);
}

// 提交、拒绝后详情会换成新的对象，版本数变了才需要重新加载
watch(
  () => [props.detail.id, props.detail.versionCount],
  () => void load(),
  { immediate: true },
);
</script>

<template>
  <el-card shadow="never" class="qf-card">
    <template #header>
      <span class="section-title">{{ t('portal.versions.title') }}</span>
      <span v-if="detail.versionCount > 0" class="muted">{{
        t('portal.versions.count', { count: detail.versionCount })
      }}</span>
    </template>
    <el-empty v-if="detail.versionCount === 0" :description="t('portal.versions.empty')" :image-size="64" />
    <el-timeline v-else v-loading="loading" class="timeline">
      <el-timeline-item
        v-for="v in versions"
        :key="v.versionNo"
        :timestamp="`${formatDateTime(v.submittedAt)} ${t('common.tz')}`"
        :type="v.versionNo === currentNo ? 'primary' : undefined"
        placement="top"
      >
        <div class="version">
          <div class="line">
            <strong>{{ t('portal.versions.version', { no: v.versionNo }) }}</strong>
            <el-tag v-if="v.versionNo === currentNo" size="small" type="success" disable-transitions>
              {{ t('portal.versions.current') }}
            </el-tag>
            <el-tag size="small" type="info" disable-transitions>{{
              t(`enums.QuoteVersionSource.${v.source}`)
            }}</el-tag>
            <span class="amount">
              {{
                t('portal.versions.total', { amount: `${v.currency} ${formatMoney(v.totalAmount ?? '', 2)}` })
              }}
            </span>
            <span class="muted">{{ t('portal.versions.submittedBy', { name: v.submittedBy.name }) }}</span>
            <el-button link type="primary" @click="view(v.versionNo)">{{
              t('portal.versions.view')
            }}</el-button>
          </div>
          <div v-if="v.changeNote" class="note">
            {{ t('portal.versions.changeNoteValue', { text: v.changeNote }) }}
          </div>
          <div v-if="v.remark" class="note">{{ t('portal.versions.remarkValue', { text: v.remark }) }}</div>
        </div>
      </el-timeline-item>
    </el-timeline>

    <el-dialog
      :model-value="viewing !== null"
      :title="
        viewing
          ? t('portal.versions.detailTitle', {
              no: viewing.versionNo,
              time: `${formatDateTime(viewing.submittedAt)} ${t('common.tz')}`,
            })
          : ''
      "
      width="90%"
      top="5vh"
      append-to-body
      destroy-on-close
      @close="viewing = null"
    >
      <template v-if="viewing">
        <el-descriptions :column="3" border class="meta">
          <el-descriptions-item :label="t('portal.versions.source')">
            {{ t(`enums.QuoteVersionSource.${viewing.source}`) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.form.total')">
            {{ viewing.currency }} {{ formatMoney(viewing.totalAmount ?? '', 2) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.versions.attachments')">
            <div v-for="f in viewing.attachments" :key="f.id">
              <el-button link type="primary" @click="previewing = f">{{ f.originalName }}</el-button>
            </div>
            <span v-if="viewing.attachments.length === 0">—</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.versions.remark')" :span="3">
            <span class="pre">{{ viewing.remark ?? '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.versions.changeNote')" :span="3">
            <span class="pre">{{ viewing.changeNote ?? '—' }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <PplLineTable
          :values="viewingValues"
          :groups="detail.template.groups"
          :columns="columns"
          :lines="lines"
          :currency="viewing.currency"
          readonly
        />
      </template>
    </el-dialog>
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
  </el-card>
</template>

<style scoped>
.section-title {
  font-weight: 600;
}
.muted {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.timeline {
  padding-left: 4px;
}
.line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.line .muted {
  margin-left: 0;
}
.amount {
  font-variant-numeric: tabular-nums;
}
.note {
  margin-top: 4px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  white-space: pre-wrap;
}
.meta {
  margin-bottom: 12px;
}
.pre {
  white-space: pre-wrap;
}
</style>
