<script setup lang="ts">
import type { FileDto, PortalFileDto, PortalQuoteDetailDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { filesApi } from '@/api/files';
import { apiError, translateError } from '@/api/http';
import { portalApi } from '@/api/portal';
import DictTag from '@/components/DictTag.vue';
import FilePreview from '@/components/FilePreview.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatFileSize } from '@/utils/files';
import { formatDateTime, pickName } from '@/utils/format';
import { remainingText } from '@/utils/inquiries';
import { portalQuoteStatus } from '@/utils/portal';
import PortalQuoteForm from './PortalQuoteForm.vue';
import PortalQuoteVersions from './PortalQuoteVersions.vue';

/**
 * 门户报价详情（M08 §5，参考 PPT #5）：询价信息 + 变更说明（第 2 轮起）+ 询价明细 + 规格附件（在线预览 / 下载，都会被记录），
 * 下面是我的报价（M09：在线填写或锁定 Excel、提交、拒绝）和历史版本。作废的旧轮次、取消的询价只读（R08-6）
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const id = computed(() => String(route.params.quoteId));
const detail = ref<PortalQuoteDetailDto | null>(null);
const loading = ref(false);
const notFound = ref(false);
const previewing = ref<FileDto | null>(null);

const status = computed(() =>
  detail.value ? portalQuoteStatus(detail.value.status, detail.value.round.status) : null,
);
const deadlineText = computed(() => {
  const deadline = detail.value?.round.deadline;
  if (!deadline) return '—';
  const time = `${formatDateTime(deadline)} ${t('common.tz')}`;
  if (detail.value?.round.status !== 'WAITING_QUOTES') return time;
  const left = remainingText(deadline);
  return t('portal.quote.deadlineValue', {
    time,
    left: left ? t('portal.quotes.left', { time: left }) : t('portal.quotes.passed'),
  });
});
const buyerText = computed(() => {
  const buyer = detail.value?.inquiry.buyer;
  if (!buyer) return '';
  return buyer.email ? t('portal.quote.buyerValue', { name: buyer.name, email: buyer.email }) : buyer.name;
});
/** 整单附件在前，然后按行号 */
const attachments = computed<(PortalFileDto & { lineNo: number | null })[]>(() =>
  detail.value
    ? [
        ...detail.value.files.map((f) => ({ ...f, lineNo: null })),
        ...detail.value.lines.flatMap((l) => l.files.map((f) => ({ ...f, lineNo: l.lineNo }))),
      ]
    : [],
);
const showChange = computed(
  () => !!detail.value && detail.value.round.roundNo > 1 && !!detail.value.round.changeReason,
);
/** 已截止：轮次不再等待报价，或者截止时间已过（截止任务还没执行时轮次仍是等待报价，R09-1） */
const closed = computed(() => {
  const round = detail.value?.round;
  return (
    !!round &&
    (round.status !== 'WAITING_QUOTES' || !round.deadline || remainingText(round.deadline) === null)
  );
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    detail.value = await portalApi.quote(id.value);
    notFound.value = false;
  } catch (err) {
    const body = apiError(err);
    notFound.value = body?.code === 'NOT_FOUND';
    if (!notFound.value) ElMessage.error(translateError(body));
  } finally {
    loading.value = false;
  }
}

function back(): void {
  void router.push({ name: 'portal-quotes' });
}

watch(
  id,
  () => {
    detail.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div v-loading="loading">
    <el-result v-if="notFound" icon="warning" :title="t('portal.quote.notFound')">
      <template #extra>
        <el-button @click="back">{{ t('portal.quote.back') }}</el-button>
      </template>
    </el-result>

    <template v-if="detail">
      <PageHeader :title="`${detail.inquiry.formalNo} · ${detail.inquiry.title}`">
        <template #actions>
          <el-button icon="Back" @click="back">{{ t('portal.quote.back') }}</el-button>
        </template>
      </PageHeader>

      <el-alert
        v-if="detail.inquiry.cancelledAt"
        type="info"
        :title="
          t('portal.quote.cancelledBanner', {
            time: `${formatDateTime(detail.inquiry.cancelledAt)} ${t('common.tz')}`,
            reason: detail.inquiry.cancelReason,
          })
        "
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        v-else-if="detail.status === 'VOID'"
        type="warning"
        :title="t('portal.quote.voidBanner', { no: detail.round.roundNo })"
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        v-else-if="closed"
        type="info"
        :title="t('portal.quote.closedBanner')"
        show-icon
        :closable="false"
        class="banner"
      />

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('portal.quote.info') }}</span>
        </template>
        <el-descriptions :column="3" border>
          <el-descriptions-item :label="t('portal.quote.fields.formalNo')">
            {{ detail.inquiry.formalNo }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.round')">
            {{ t('portal.quotes.roundNo', { no: detail.round.roundNo }) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.status')">
            <StatusTag v-if="status" enum-name="PortalQuoteStatus" :value="status" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.title')" :span="2">
            {{ detail.inquiry.title }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.currency')">
            <DictTag type="currency" :code="detail.inquiry.currency" plain />
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.deadline')" :span="2">
            {{ deadlineText }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.invitedAt')">
            {{ formatDateTime(detail.invitedAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.fields.buyer')" :span="3">
            {{ buyerText }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detail.inquiry.description"
            :label="t('portal.quote.fields.description')"
            :span="3"
          >
            <span class="pre">{{ detail.inquiry.description }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="showChange" shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('portal.quote.change', { no: detail.round.roundNo }) }}</span>
        </template>
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="t('portal.quote.changeReason')">
            <span class="pre">{{ detail.round.changeReason }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('portal.quote.changeSummary')">
            <span class="pre">{{ detail.round.changeSummary }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('portal.quote.lines', { count: detail.lines.length }) }}</span>
        </template>
        <el-table :data="detail.lines" :empty-text="t('common.table.empty')">
          <el-table-column prop="lineNo" :label="t('portal.quote.lineFields.lineNo')" width="70" />
          <el-table-column :label="t('portal.quote.lineFields.materialCode')" width="130">
            <template #default="{ row }">{{ row.materialCode ?? '—' }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.name')" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ pickName(row, locale) }}</template>
          </el-table-column>
          <el-table-column
            prop="spec"
            :label="t('portal.quote.lineFields.spec')"
            min-width="200"
            show-overflow-tooltip
          />
          <el-table-column :label="t('portal.quote.lineFields.quantity')" width="120" align="right">
            <template #default="{ row }">{{ row.quantity }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.unit')" width="80">
            <template #default="{ row }"><DictTag type="unit" :code="row.unitCode" plain /></template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.brand')" width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.brand ?? '—' }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.drawingRef')" width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.drawingRef ?? '—' }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.category')" width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ pickName(row.category, locale) }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.lineFields.files')" min-width="180">
            <template #default="{ row }">
              <div v-for="f in row.files" :key="f.id">
                <el-button link type="primary" @click="previewing = f.file">{{
                  f.file.originalName
                }}</el-button>
              </div>
              <span v-if="row.files.length === 0" class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="qf-card section files-card">
        <template #header>
          <span class="section-title">{{ t('portal.quote.files') }}</span>
          <span class="hint">{{ t('portal.quote.filesHint') }}</span>
        </template>
        <el-table :data="attachments" :empty-text="t('portal.quote.noFiles')">
          <el-table-column :label="t('portal.quote.fileFields.line')" width="110">
            <template #default="{ row }">
              {{
                row.lineNo === null
                  ? t('portal.quote.wholeRfq')
                  : t('portal.quote.lineNo', { no: row.lineNo })
              }}
            </template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.fileFields.name')" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.file.originalName }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.fileFields.size')" width="100">
            <template #default="{ row }">{{ formatFileSize(row.file.size) }}</template>
          </el-table-column>
          <el-table-column :label="t('portal.quote.fileFields.uploadedAt')" width="160">
            <template #default="{ row }">{{ formatDateTime(row.file.createdAt) }}</template>
          </el-table-column>
          <el-table-column :label="t('common.table.actions')" width="230">
            <template #default="{ row }">
              <el-button link type="primary" icon="View" @click="previewing = row.file">
                {{ t('portal.quote.preview') }}
              </el-button>
              <el-button
                link
                type="primary"
                icon="Download"
                tag="a"
                :href="filesApi.contentUrl(row.file.id, 'attachment')"
              >
                {{ t('portal.quote.download') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <PortalQuoteForm :detail="detail" class="section" @changed="detail = $event" />
      <PortalQuoteVersions :detail="detail" class="section" />

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
.banner,
.section {
  margin-bottom: 16px;
}
.section-title {
  font-weight: 600;
}
.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.pre {
  white-space: pre-wrap;
}
.muted {
  color: var(--el-text-color-placeholder);
}
/* 下载按钮是 <a>，去掉链接下划线，和"在线预览"一致 */
a.el-button {
  text-decoration: none;
}
</style>
