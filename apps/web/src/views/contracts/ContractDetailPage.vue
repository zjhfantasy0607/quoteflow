<script setup lang="ts">
import {
  CONTRACT_STEPS,
  type ApprovalAction,
  type ContractAction,
  type ContractApprovalDto,
  type ContractDetailDto,
  type ContractStatus,
  type ContractStep,
  type FileDto,
  type NegotiationMsgType,
  type PplColumnType,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { contractsApi } from '@/api/contracts';
import { apiError, translateError } from '@/api/http';
import FilePreview from '@/components/FilePreview.vue';
import MaskedValue from '@/components/MaskedValue.vue';
import PageHeader from '@/components/PageHeader.vue';
import PplValueDisplay from '@/components/PplValueDisplay.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { contractLines } from '@/utils/contracts';
import { confirmAction } from '@/utils/dialogs';
import { formatFileSize } from '@/utils/files';
import { formatDateTime, formatMoney, pickLabel, pickName } from '@/utils/format';
import ContractEditDialog from './ContractEditDialog.vue';
import SignedScanDialog from './SignedScanDialog.vue';

/**
 * 合同详情（M14 §5，参考 PPT #25）：左侧合同信息与定标快照（询价信息、询价行与中标报价的关键列、议价记录、规格与报价附件），
 * 右侧审批步骤条（提交审核 → 合同审核 → 合同批准）、审批操作、审批记录、合同附件与签字扫描件。
 * 按钮由 allowedActions 决定；没有 contract.amount 时金额（含快照里的金额列和议价价格）显示 🔒
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const id = computed(() => String(route.params.id));
const contract = ref<ContractDetailDto | null>(null);
const loading = ref(false);
const notFound = ref(false);
const acting = ref(false);
const comment = ref('');
const editVisible = ref(false);
const scanVisible = ref(false);
const previewing = ref<Pick<FileDto, 'id' | 'originalName'> | null>(null);

const can = (action: ContractAction) => contract.value?.allowedActions.includes(action) ?? false;
const masked = (field: string) => contract.value?.maskedFields?.includes(field) ?? false;
const amountMasked = computed(() => masked('amount'));
const snapshot = computed(() => contract.value?.snapshot ?? null);
const time = (iso: string | null) => (iso ? `${formatDateTime(iso)} ${t('common.tz')}` : '—');
const printHref = computed(() => router.resolve({ name: 'contract-print', params: { id: id.value } }).href);

const lines = computed(() => (snapshot.value ? contractLines(snapshot.value) : []));
/** 明细表直接显示的报价列：keyField 标记的报价方填写列和公式列（预填列来自询价行，已单独显示） */
const keyColumns = computed(
  () => snapshot.value?.columns.filter((c) => c.keyField && c.source !== 'prefill') ?? [],
);
/** 其余报价列在展开行里显示 */
const otherColumns = computed(
  () => snapshot.value?.columns.filter((c) => !c.keyField && c.source !== 'prefill') ?? [],
);
const NUMERIC: readonly PplColumnType[] = ['int', 'decimal', 'money', 'percent'];
const lineNoOf = computed(() => new Map(lines.value.map((l) => [l.lineId, l.lineNo])));

/** 审核、批准环节（同一时间最多一个） */
const decisionStep = computed<'review' | 'approve' | null>(() =>
  can('review') ? 'review' : can('approve') ? 'approve' : null,
);
/** 驳回后回到草稿：顶部提示最近一次驳回的环节和意见，步骤条上该环节标红 */
const lastReject = computed(() => {
  const c = contract.value;
  const last = c?.approvals.at(-1);
  return c?.status === 'DRAFT' && last?.action === 'REJECT' ? last : null;
});
/** 草稿停在"提交审核"，待审核停在"合同审核"，待批准停在"合同批准"，已批准全部完成 */
const STEP_INDEX: Record<ContractStatus, number> = {
  DRAFT: 0,
  PENDING_REVIEW: 1,
  PENDING_APPROVAL: 2,
  APPROVED: 3,
};
const activeStep = computed(() => (contract.value ? STEP_INDEX[contract.value.status] : 0));

/** 步骤下方显示的人和时间：已完成的取本环节最近一次通过（提交）的记录，被驳回的取驳回记录 */
function stepRecord(step: ContractStep, index: number): ContractApprovalDto | null {
  if (lastReject.value?.step === step) return lastReject.value;
  if (index >= activeStep.value) return null;
  const approvals = contract.value?.approvals ?? [];
  return [...approvals].reverse().find((a) => a.step === step && a.action !== 'REJECT') ?? null;
}

const TIMELINE_TYPE: Record<ApprovalAction, 'primary' | 'success' | 'danger'> = {
  SUBMIT: 'primary',
  APPROVE: 'success',
  REJECT: 'danger',
};
const NEGOTIATION_TYPE: Record<NegotiationMsgType, 'primary' | 'warning' | 'success' | 'danger' | 'info'> = {
  OFFER: 'primary',
  COUNTER: 'warning',
  ACCEPT: 'success',
  REJECT: 'danger',
  CLOSE: 'info',
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    contract.value = await contractsApi.get(id.value);
    notFound.value = false;
  } catch (err) {
    const body = apiError(err);
    notFound.value = body?.code === 'NOT_FOUND';
    if (!notFound.value) ElMessage.error(translateError(body));
  } finally {
    loading.value = false;
  }
}

/** 动作接口返回最新详情，用它刷新页面 */
async function run(action: () => Promise<ContractDetailDto>, done: string): Promise<void> {
  acting.value = true;
  try {
    contract.value = await action();
    comment.value = '';
    ElMessage.success(done);
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function submit(): Promise<void> {
  if (!(await confirmAction(t('contracts.submitConfirm'), { type: 'info' }))) return;
  await run(() => contractsApi.submit(id.value), t('contracts.submitted'));
}

/** R14-4：审核、批准都可以驳回，驳回意见必填，合同回到草稿 */
async function decide(action: 'APPROVE' | 'REJECT'): Promise<void> {
  const step = decisionStep.value;
  if (!step) return;
  const text = comment.value.trim();
  if (action === 'REJECT' && !text) {
    ElMessage.warning(t('contracts.commentRequired'));
    return;
  }
  const approveText = step === 'review' ? 'contracts.reviewConfirm' : 'contracts.approveConfirm';
  const ok = await confirmAction(t(action === 'REJECT' ? 'contracts.rejectConfirm' : approveText), {
    type: action === 'REJECT' ? 'warning' : 'info',
  });
  if (!ok) return;
  const done =
    action === 'REJECT'
      ? 'contracts.rejected'
      : step === 'review'
        ? 'contracts.reviewed'
        : 'contracts.approved';
  await run(() => contractsApi[step](id.value, { action, comment: text || undefined }), t(done));
}

function onUpdated(updated: ContractDetailDto): void {
  contract.value = updated;
}

function back(): void {
  void router.push({ name: 'contracts' });
}

watch(
  id,
  () => {
    contract.value = null;
    comment.value = '';
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div v-loading="loading">
    <el-result v-if="notFound" icon="warning" :title="t('contracts.detail.notFound')">
      <template #extra>
        <el-button @click="back">{{ t('contracts.detail.back') }}</el-button>
      </template>
    </el-result>

    <template v-if="contract && snapshot">
      <PageHeader
        :title="contract.contractNo"
        :subtitle="`${contract.inquiry.formalNo} · ${contract.inquiry.title}`"
      >
        <template #actions>
          <el-button icon="Back" @click="back">{{ t('contracts.detail.back') }}</el-button>
          <el-button tag="a" :href="printHref" target="_blank" icon="Printer" class="print-button">
            {{ t('contracts.actions.print') }}
          </el-button>
          <el-button v-if="can('edit')" icon="Edit" @click="editVisible = true">
            {{ t('contracts.actions.edit') }}
          </el-button>
          <el-button v-if="can('submit')" type="primary" icon="Promotion" :loading="acting" @click="submit">
            {{ t('contracts.actions.submit') }}
          </el-button>
          <el-button v-if="can('uploadSignedScan')" type="primary" icon="Upload" @click="scanVisible = true">
            {{
              contract.signedScan
                ? t('contracts.actions.replaceSignedScan')
                : t('contracts.actions.uploadSignedScan')
            }}
          </el-button>
        </template>
      </PageHeader>

      <el-alert
        v-if="lastReject"
        type="warning"
        :title="
          t('contracts.detail.rejectedBanner', {
            step: t(`contracts.steps.${lastReject.step}`),
            name: lastReject.actor.name,
            comment: lastReject.comment,
          })
        "
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        :title="t('contracts.detail.eSignHint')"
        type="info"
        show-icon
        :closable="false"
        class="banner"
      />

      <el-row :gutter="16">
        <el-col :xs="24" :lg="17">
          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.info') }}</span>
            </template>
            <el-descriptions :column="2" border class="info">
              <el-descriptions-item :label="t('contracts.fields.contractNo')">
                {{ contract.contractNo }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.status')">
                <StatusTag enum-name="ContractStatus" :value="contract.status" />
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.inquiryNo')">
                <router-link
                  v-if="auth.hasPerm('inquiry:view')"
                  :to="{ name: 'inquiry-detail', params: { id: contract.inquiry.id } }"
                  class="link"
                >
                  {{ contract.inquiry.formalNo }}
                </router-link>
                <span v-else>{{ contract.inquiry.formalNo }}</span>
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.supplier')">
                {{ contract.supplier.code }} {{ pickName(contract.supplier, locale) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.amount')">
                <MaskedValue :masked="amountMasked">
                  <strong class="amount"
                    >{{ contract.currency }} {{ formatMoney(contract.amount, 2) }}</strong
                  >
                </MaskedValue>
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.deliveryDate')">
                {{ contract.deliveryDate ?? '—' }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.deliveryPlace')">
                {{ contract.deliveryPlace ?? '—' }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.paymentTerms')">
                {{ contract.paymentTerms ?? '—' }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.createdBy')">
                {{ contract.createdBy.name }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.createdAt')">
                {{ time(contract.createdAt) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.summary')" :span="2">
                <span class="pre">{{ contract.summary ?? '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.remark')" :span="2">
                <span class="pre">{{ contract.remark ?? '—' }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">
                {{
                  t('contracts.detail.snapshot', {
                    no: snapshot.inquiry.roundNo,
                    time: time(snapshot.capturedAt),
                  })
                }}
              </span>
            </template>
            <el-descriptions :column="2" border class="info">
              <el-descriptions-item :label="t('contracts.detail.inquiry')">
                {{ snapshot.inquiry.formalNo }} · {{ snapshot.inquiry.title }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.detail.projectNo')">
                {{ snapshot.inquiry.projectNo }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.detail.materialCategory')">
                {{ pickName(snapshot.inquiry.materialCategory, locale) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.detail.owner')">
                {{ snapshot.inquiry.owner.name }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.fields.supplier')">
                {{ snapshot.supplier.code }} {{ pickName(snapshot.supplier, locale) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('contracts.detail.supplierContact')">
                <div class="contact">
                  <span>{{ snapshot.supplier.contactName }}</span>
                  <MaskedValue :masked="masked('contactPhone')">
                    <span v-if="snapshot.supplier.contactPhone">{{ snapshot.supplier.contactPhone }}</span>
                  </MaskedValue>
                  <MaskedValue :masked="masked('contactEmail')">
                    <span>{{ snapshot.supplier.contactEmail }}</span>
                  </MaskedValue>
                </div>
              </el-descriptions-item>
            </el-descriptions>

            <div class="sub-title">
              {{ t('contracts.detail.lines', { no: snapshot.quoteVersion.versionNo }) }}
            </div>
            <el-table :data="lines" row-key="lineId" size="small" border>
              <el-table-column v-if="otherColumns.length > 0" type="expand" width="40">
                <template #default="{ row }">
                  <el-descriptions :column="2" size="small" class="expand">
                    <el-descriptions-item
                      v-for="c in otherColumns"
                      :key="c.key"
                      :label="pickLabel(c, locale)"
                    >
                      <PplValueDisplay
                        :column="c"
                        :value="row.values[c.key]"
                        :masked="amountMasked && !!c.sensitive"
                      />
                    </el-descriptions-item>
                  </el-descriptions>
                </template>
              </el-table-column>
              <el-table-column prop="lineNo" :label="t('contracts.detail.lineFields.lineNo')" width="56" />
              <el-table-column
                :label="`${t('contracts.detail.lineFields.item')} / ${t('contracts.detail.lineFields.spec')}`"
                min-width="180"
              >
                <template #default="{ row }">
                  <div>
                    <span v-if="row.materialCode" class="code">{{ row.materialCode }}</span>
                    {{ pickName(row, locale) }}
                  </div>
                  <div class="spec">{{ row.spec }}</div>
                </template>
              </el-table-column>
              <el-table-column
                :label="t('contracts.detail.lineFields.quantity')"
                min-width="110"
                align="right"
              >
                <template #default="{ row }">
                  <el-tooltip
                    v-if="row.negotiated"
                    :content="t('contracts.detail.inquiryQuantity', { quantity: row.inquiryQuantity })"
                    placement="top"
                  >
                    <el-tag size="small" type="warning" effect="plain" disable-transitions class="tag">
                      {{ t('contracts.detail.negotiated') }}
                    </el-tag>
                  </el-tooltip>
                  {{ row.quantity }} {{ pickName(row.unit, locale) }}
                </template>
              </el-table-column>
              <el-table-column
                v-for="c in keyColumns"
                :key="c.key"
                :label="pickLabel(c, locale)"
                min-width="96"
                :align="NUMERIC.includes(c.type) ? 'right' : 'left'"
              >
                <template #default="{ row }">
                  <PplValueDisplay
                    :column="c"
                    :value="row.values[c.key]"
                    :masked="amountMasked && !!c.sensitive"
                  />
                </template>
              </el-table-column>
            </el-table>
            <div class="total">
              <span>{{ t('contracts.detail.total') }}</span>
              <MaskedValue :masked="amountMasked">
                <strong class="amount">
                  {{ snapshot.quoteVersion.currency }} {{ formatMoney(snapshot.quoteVersion.totalAmount, 2) }}
                </strong>
              </MaskedValue>
            </div>

            <div v-if="snapshot.files.length > 0" class="sub-title">{{ t('contracts.detail.files') }}</div>
            <ul v-if="snapshot.files.length > 0" class="file-list">
              <li v-for="f in snapshot.files" :key="f.fileId">
                <el-tag size="small" effect="plain" disable-transitions>
                  {{
                    f.lineNo === null
                      ? t('contracts.detail.wholeRfq')
                      : t('contracts.detail.lineNo', { no: f.lineNo })
                  }}
                </el-tag>
                <span class="kind">{{ t(`contracts.detail.fileKinds.${f.kind}`) }}</span>
                <el-button
                  link
                  type="primary"
                  @click="previewing = { id: f.fileId, originalName: f.originalName }"
                >
                  {{ f.originalName }}
                </el-button>
              </li>
            </ul>
            <div v-if="snapshot.quoteVersion.attachments.length > 0" class="sub-title">
              {{ t('contracts.detail.quoteAttachments') }}
            </div>
            <ul v-if="snapshot.quoteVersion.attachments.length > 0" class="file-list">
              <li v-for="f in snapshot.quoteVersion.attachments" :key="f.fileId">
                <el-icon><Document /></el-icon>
                <el-button
                  link
                  type="primary"
                  @click="previewing = { id: f.fileId, originalName: f.originalName }"
                >
                  {{ f.originalName }}
                </el-button>
              </li>
            </ul>
          </el-card>

          <el-card
            v-if="snapshot.negotiation && snapshot.negotiation.length > 0"
            shadow="never"
            class="qf-card section"
          >
            <template #header>
              <span class="section-title">{{ t('contracts.detail.negotiation') }}</span>
            </template>
            <el-timeline>
              <el-timeline-item
                v-for="m in snapshot.negotiation"
                :key="m.seq"
                :timestamp="time(m.createdAt)"
                :type="NEGOTIATION_TYPE[m.type]"
                placement="top"
              >
                <div class="neg-head">
                  <span class="party">{{ t(`enums.NegotiationParty.${m.party}`) }}</span>
                  <el-tag size="small" :type="NEGOTIATION_TYPE[m.type]" disable-transitions>
                    {{ t(`enums.NegotiationMsgType.${m.type}`) }}
                  </el-tag>
                </div>
                <el-table
                  v-if="m.lines.length > 0"
                  :data="m.lines"
                  size="small"
                  class="neg-lines"
                  row-key="lineId"
                >
                  <el-table-column :label="t('negotiation.fields.lineNo')" width="64">
                    <template #default="{ row }">{{ lineNoOf.get(row.lineId) ?? '' }}</template>
                  </el-table-column>
                  <el-table-column :label="t('negotiation.fields.price')" min-width="110" align="right">
                    <template #default="{ row }">
                      <MaskedValue :masked="row.unitPriceInclTax === null">
                        <span>{{ row.unitPriceInclTax ? formatMoney(row.unitPriceInclTax, 4) : '—' }}</span>
                      </MaskedValue>
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('negotiation.fields.newQuantity')" min-width="90" align="right">
                    <template #default="{ row }">{{ row.quantity ?? '—' }}</template>
                  </el-table-column>
                  <el-table-column
                    :label="t('negotiation.fields.specNote')"
                    min-width="160"
                    show-overflow-tooltip
                  >
                    <template #default="{ row }">{{ row.specNote ?? '—' }}</template>
                  </el-table-column>
                </el-table>
                <div v-if="m.content" class="neg-content">
                  {{
                    t('contracts.detail.negotiationContent', {
                      label:
                        m.type === 'REJECT' || m.type === 'COUNTER'
                          ? t('negotiation.fields.reason')
                          : t('negotiation.fields.content'),
                      content: m.content,
                    })
                  }}
                </div>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </el-col>

        <el-col :xs="24" :lg="7">
          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.steps') }}</span>
            </template>
            <el-steps :active="activeStep" finish-status="success" direction="vertical" :space="64">
              <el-step
                v-for="(step, index) in CONTRACT_STEPS"
                :key="step"
                :title="t(`contracts.steps.${step}`)"
                :status="lastReject?.step === step ? 'error' : undefined"
              >
                <template #description>
                  <span v-if="stepRecord(step, index)">
                    {{ stepRecord(step, index)!.actor.name }} · {{ time(stepRecord(step, index)!.createdAt) }}
                  </span>
                </template>
              </el-step>
            </el-steps>
          </el-card>

          <el-card v-if="decisionStep" shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.approvalPanel') }}</span>
            </template>
            <el-input
              v-model="comment"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              :placeholder="t('contracts.detail.commentPlaceholder')"
            />
            <div class="decision-actions">
              <el-button type="danger" plain :loading="acting" @click="decide('REJECT')">
                {{ t('contracts.actions.reject') }}
              </el-button>
              <el-button type="primary" :loading="acting" @click="decide('APPROVE')">
                {{
                  decisionStep === 'review'
                    ? t('contracts.actions.reviewApprove')
                    : t('contracts.actions.approve')
                }}
              </el-button>
            </div>
          </el-card>

          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.approvals') }}</span>
            </template>
            <el-timeline v-if="contract.approvals.length > 0">
              <el-timeline-item
                v-for="a in contract.approvals"
                :key="a.id"
                :type="TIMELINE_TYPE[a.action]"
                :timestamp="time(a.createdAt)"
                placement="top"
              >
                <div class="approval-title">
                  {{ t(`contracts.timeline.${a.step}_${a.action}`, { name: a.actor.name }) }}
                </div>
                <div v-if="a.comment" class="pre">
                  {{ t('contracts.timeline.comment', { comment: a.comment }) }}
                </div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else :description="t('contracts.detail.noApprovals')" :image-size="64" />
          </el-card>

          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.attachments') }}</span>
            </template>
            <ul v-if="contract.attachments.length > 0" class="file-list">
              <li v-for="f in contract.attachments" :key="f.id">
                <el-icon><Document /></el-icon>
                <el-button link type="primary" class="file-name" @click="previewing = f">{{
                  f.originalName
                }}</el-button>
                <span class="size">{{ formatFileSize(f.size) }}</span>
              </li>
            </ul>
            <div v-else class="muted">{{ t('contracts.detail.noAttachments') }}</div>
          </el-card>

          <el-card shadow="never" class="qf-card section">
            <template #header>
              <span class="section-title">{{ t('contracts.detail.signed') }}</span>
            </template>
            <template v-if="contract.signedScan">
              <div class="file-list">
                <el-icon><Document /></el-icon>
                <el-button link type="primary" class="file-name" @click="previewing = contract.signedScan">
                  {{ contract.signedScan.originalName }}
                </el-button>
              </div>
              <div class="muted">{{ t('contracts.detail.signedAt', { time: time(contract.signedAt) }) }}</div>
            </template>
            <div v-else class="muted">{{ t('contracts.detail.notSigned') }}</div>
          </el-card>
        </el-col>
      </el-row>

      <ContractEditDialog v-model="editVisible" :contract="contract" @saved="onUpdated" />
      <SignedScanDialog v-model="scanVisible" :contract="contract" @uploaded="onUpdated" />
    </template>

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
.sub-title {
  margin: 20px 0 8px;
  font-weight: 600;
}
.link {
  color: var(--el-color-primary);
}
.print-button {
  text-decoration: none;
}
.info :deep(.el-descriptions__label) {
  white-space: nowrap;
}
.spec {
  color: var(--el-text-color-secondary);
  white-space: pre-wrap;
}
.amount {
  font-variant-numeric: tabular-nums;
}
.pre {
  white-space: pre-wrap;
}
.contact {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.code {
  margin-right: 4px;
  color: var(--el-text-color-secondary);
}
.tag {
  margin-right: 4px;
}
.expand {
  padding: 4px 16px;
}
.total {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.file-list li,
div.file-list {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.file-name {
  max-width: 260px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.kind,
.size,
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.neg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.party {
  font-weight: 500;
}
.neg-lines {
  margin-bottom: 6px;
}
.neg-content {
  white-space: pre-wrap;
}
.approval-title {
  font-weight: 500;
}
.decision-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
