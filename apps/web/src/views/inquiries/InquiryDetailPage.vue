<script setup lang="ts">
import type {
  AuditLogDto,
  InquiryAction,
  InquiryApprovalDto,
  InquiryDetailDto,
  InquiryRoundBriefDto,
  InquiryRoundDto,
  RoundDiffDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import DictTag from '@/components/DictTag.vue';
import PageHeader from '@/components/PageHeader.vue';
import RoundDiffTable from '@/components/RoundDiffTable.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction, promptText } from '@/utils/dialogs';
import { formatDateTime, pickName } from '@/utils/format';
import { inquiryNo, remainingText } from '@/utils/inquiries';
import ApprovalTimeline from './ApprovalTimeline.vue';
import InquiryAccessLogsTab from './InquiryAccessLogsTab.vue';
import InquiryEvaluationTab from './InquiryEvaluationTab.vue';
import InquiryFilesSection from './InquiryFilesSection.vue';
import InquiryInviteesTab from './InquiryInviteesTab.vue';
import InquiryLinesTable from './InquiryLinesTable.vue';
import InquiryLogs from './InquiryLogs.vue';
import InquiryNegotiationTab from './InquiryNegotiationTab.vue';
import InquiryResponsesTab from './InquiryResponsesTab.vue';
import PublishDialog from './PublishDialog.vue';
import RoundProgress from './RoundProgress.vue';

/**
 * 询价单详情（M06 §5、M07 §5、M10 §5、M11 §5）：表头卡片 + 轮次进度条（发布后）+ 按 allowedActions 显示的操作 + 页签（明细与附件 /
 * 邀请供应商 / 供应商响应（发布后） / 比价评标（开标后） / 议价（有入围时） / 审批记录 / 下载日志（M08） / 操作日志）；
 * 待审批时页面底部是"审批操作"区（参考 PPT #22）。?tab= 指定打开的页签（从报价详情返回时回到"供应商响应"，议价邮件链接到"议价"）。
 * M12：定标在"比价评标"页签；评标完成后顶部是完成横幅（中标供应商、定标人与时间、定标说明、合同草稿号，参考 PPT #11），
 * 整单只读（按钮由 allowedActions 决定）。
 * M13：有第 2 轮起显示轮次页签条（第 1 轮（已作废）🔒只读 / 第 2 轮（等待报价）/ 第 3 轮（变更草稿），参考 PPT #12），
 * 切到作废的旧轮次时下方明细、响应、比价、议价都按那一轮显示且只读；变更草稿进入编辑页。第 2 轮起显示该轮的变更说明与规格对比
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const id = computed(() => String(route.params.id));
const inquiry = ref<InquiryDetailDto | null>(null);
const round = ref<InquiryRoundDto | null>(null);
const approvals = ref<InquiryApprovalDto[]>([]);
const logs = ref<AuditLogDto[]>([]);
const logsLoading = ref(false);
const loading = ref(false);
const notFound = ref(false);
const tab = ref('lines');
const comment = ref('');
const acting = ref(false);
const approvalPanel = ref<HTMLElement | null>(null);
const publishVisible = ref(false);
/** "邀请供应商"页签里有没保存的修改 */
const inviteesDirty = ref(false);
/** 议价有变化时加 1，"比价评标"页签据此重新加载矩阵 */
const matrixRefresh = ref(0);
/** 全部轮次（M13） */
const rounds = ref<InquiryRoundBriefDto[]>([]);
/** 正在查看的轮次；null = 当前轮次 */
const viewRoundNo = ref<number | null>(null);
/** 所选轮次（第 2 轮起）与上一轮的规格对比 */
const diff = ref<RoundDiffDto | null>(null);

const can = (action: InquiryAction) => inquiry.value?.allowedActions.includes(action) ?? false;
const canReview = computed(() => can('approve') || can('reject'));
const currentNo = computed(() => inquiry.value?.currentRoundNo ?? 1);
const selectedNo = computed(() => viewRoundNo.value ?? currentNo.value);
/** 在看作废的旧轮次（R13-8 只读） */
const viewingOld = computed(() => selectedNo.value !== currentNo.value);
const selectedRound = computed(() => rounds.value.find((r) => r.roundNo === selectedNo.value) ?? null);
/** 轮次页签条：有第 2 轮（含变更草稿）时才显示 */
const showRounds = computed(() => rounds.value.length > 1);
/** 所选轮次已发布（有供应商参与） */
const published = computed(() =>
  viewingOld.value ? !!selectedRound.value?.publishedAt : !!inquiry.value?.currentRound.publishedAt,
);
/** R11-1：开标后才有比价（开过标的旧轮次照样能看，R13-5）；有入围供应商时才有议价页签 */
const canEvaluate = computed(() =>
  viewingOld.value ? !!selectedRound.value?.openedAt && auth.hasPerm('inquiry:evaluate') : can('evaluate'),
);
const hasShortlist = computed(
  () =>
    canEvaluate.value &&
    ((viewingOld.value ? selectedRound.value?.shortlistCount : inquiry.value?.currentRound.shortlistCount) ??
      0) > 0,
);
/** 能打开的页签（?tab= 指定的不在里面时打开明细） */
const tabs = computed(() => [
  'lines',
  'invitees',
  ...(published.value ? ['responses'] : []),
  ...(canEvaluate.value ? ['evaluation'] : []),
  ...(hasShortlist.value ? ['negotiation'] : []),
  'approvals',
  ...(can('viewAccessLog') ? ['accessLogs'] : []),
  'logs',
]);
/** 只有等待报价时才显示剩余时间；提前截止的注明提前截止（之后截止时间还没到，不能再显示"剩余"） */
const deadlineText = computed(() => {
  const deadline = inquiry.value?.currentDeadline;
  if (!deadline) return t('inquiries.detail.deadlineNotSet');
  const round = inquiry.value!.currentRound;
  const time = `${formatDateTime(deadline)} ${t('common.tz')}`;
  const left = remainingText(deadline);
  let state: string | null;
  if (round.status === 'WAITING_QUOTES') {
    state = left ? t('inquiries.detail.deadlineLeft', { time: left }) : t('inquiries.detail.deadlinePassed');
  } else if (round.closedEarly) {
    state = t('inquiries.detail.deadlineClosedEarly');
  } else {
    state = left ? null : t('inquiries.detail.deadlinePassed');
  }
  return state ? t('inquiries.detail.deadlineValue', { time, left: state }) : time;
});

/** 所选轮次的询价行与附件；第 2 轮起另取规格对比 */
async function loadRound(): Promise<void> {
  if (!inquiry.value) return;
  const no = selectedNo.value;
  round.value = await inquiriesApi.round(inquiry.value.id, no);
  diff.value = no > 1 ? await inquiriesApi.roundDiff(inquiry.value.id, no) : null;
}

async function loadRounds(): Promise<void> {
  rounds.value = await inquiriesApi.rounds(id.value);
}

/** 轮次页签条：变更草稿进入编辑页，其余切换下方内容 */
async function selectRound(no: number): Promise<void> {
  const target = rounds.value.find((r) => r.roundNo === no);
  if (target?.status === 'DRAFT' && no > 1) {
    await router.push({ name: 'inquiry-change', params: { id: id.value, roundNo: no } });
    return;
  }
  viewRoundNo.value = no === currentNo.value ? null : no;
  if (!tabs.value.includes(tab.value)) tab.value = 'lines';
  await loadRound();
}

const roundLabel = (r: InquiryRoundBriefDto) =>
  t('inquiries.rounds.tabLabel', {
    no: r.roundNo,
    status:
      r.status === 'DRAFT' && r.roundNo > 1
        ? t('inquiries.rounds.draft')
        : t(`enums.RoundStatus.${r.status}`),
  });

/** R13-1：复制当前轮生成变更草稿，进入编辑页 */
async function startChange(): Promise<void> {
  const params = { current: currentNo.value, no: (rounds.value.at(-1)?.roundNo ?? currentNo.value) + 1 };
  if (!(await confirmAction(t('inquiries.change.startConfirm', params), { type: 'info' }))) return;
  acting.value = true;
  try {
    const created = await inquiriesApi.createChangeRound(id.value, {});
    ElMessage.success(t('inquiries.change.started', { no: created.roundNo }));
    await router.push({ name: 'inquiry-change', params: { id: id.value, roundNo: created.roundNo } });
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function loadApprovals(): Promise<void> {
  approvals.value = await inquiriesApi.approvals(id.value);
}

async function loadLogs(): Promise<void> {
  logsLoading.value = true;
  try {
    logs.value = await inquiriesApi.timeline(id.value);
  } finally {
    logsLoading.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    inquiry.value = await inquiriesApi.get(id.value);
    notFound.value = false;
    await Promise.all([loadRound(), loadRounds(), loadApprovals()]);
    if (tab.value === 'logs') await loadLogs();
  } catch (err) {
    const body = apiError(err);
    notFound.value = body?.code === 'NOT_FOUND';
    if (!notFound.value) ElMessage.error(translateError(body));
  } finally {
    loading.value = false;
  }
}

/** 动作接口返回最新详情，用它刷新页面 */
async function afterAction(updated: InquiryDetailDto): Promise<void> {
  inquiry.value = updated;
  comment.value = '';
  await Promise.all([
    loadRound(),
    loadRounds(),
    loadApprovals(),
    tab.value === 'logs' ? loadLogs() : Promise.resolve(),
  ]);
}

/** 入围名单变化后刷新详情（入围家数决定"议价"页签是否出现） */
async function reloadInquiry(): Promise<void> {
  inquiry.value = await inquiriesApi.get(id.value);
}

async function submit(): Promise<void> {
  if (!(await confirmAction(t('inquiries.edit.submitConfirm'), { type: 'info' }))) return;
  acting.value = true;
  try {
    await afterAction(await inquiriesApi.submit(id.value));
    ElMessage.success(t('inquiries.edit.submitted'));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function approve(): Promise<void> {
  if (!(await confirmAction(t('inquiries.detail.approveConfirm'), { type: 'info' }))) return;
  acting.value = true;
  try {
    const updated = await inquiriesApi.approve(id.value, comment.value.trim() || undefined);
    await afterAction(updated);
    ElMessage.success(t('inquiries.detail.approved', { formalNo: updated.formalNo }));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function reject(): Promise<void> {
  if (!comment.value.trim()) {
    ElMessage.warning(t('inquiries.detail.commentRequired'));
    return;
  }
  acting.value = true;
  try {
    await afterAction(await inquiriesApi.reject(id.value, comment.value.trim()));
    ElMessage.success(t('inquiries.detail.rejected'));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

function openPublish(): void {
  if (inviteesDirty.value) {
    ElMessage.warning(t('inquiries.publish.saveInviteesFirst'));
    tab.value = 'invitees';
    return;
  }
  publishVisible.value = true;
}

async function onPublished(updated: InquiryDetailDto): Promise<void> {
  await afterAction(updated);
  tab.value = 'responses';
}

/** R10-3：开标后各家报价对有评标权限的人可见，已报价的供应商收到开标通知 */
async function openBids(): Promise<void> {
  if (!(await confirmAction(t('inquiries.detail.openConfirm'), { type: 'warning' }))) return;
  acting.value = true;
  try {
    await afterAction(await inquiriesApi.open(id.value, inquiry.value!.currentRoundNo));
    tab.value = 'responses';
    ElMessage.success(t('inquiries.detail.opened'));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

async function cancel(): Promise<void> {
  // R07-11：发布后取消，原因会写进发给供应商的取消通知
  const prompt = published.value ? 'inquiries.detail.cancelPromptPublished' : 'inquiries.detail.cancelPrompt';
  const reason = await promptText(t(prompt), t('inquiries.detail.cancelTitle'), {
    inputType: 'textarea',
    inputValidator: (v: string) => (v && v.trim().length > 0) || t('inquiries.detail.reasonRequired'),
    confirmButtonClass: 'el-button--danger',
  });
  if (reason === null) return;
  acting.value = true;
  try {
    await afterAction(await inquiriesApi.cancel(id.value, reason.trim()));
    ElMessage.success(t('inquiries.detail.cancelled'));
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    acting.value = false;
  }
}

function back(): void {
  if (route.query.from === 'approvals') void router.push({ name: 'inquiry-approvals' });
  else void router.push({ name: 'inquiries' });
}

watch(tab, (value) => {
  if (value === 'logs') void loadLogs();
});

watch(
  id,
  async () => {
    inquiry.value = null;
    round.value = null;
    rounds.value = [];
    viewRoundNo.value = null;
    diff.value = null;
    logs.value = [];
    tab.value = typeof route.query.tab === 'string' ? route.query.tab : 'lines';
    inviteesDirty.value = false;
    await load();
    if (inquiry.value && !tabs.value.includes(tab.value)) tab.value = 'lines';
    // 从"待我审批"进来时直接滚到审批操作区
    if (route.query.from === 'approvals' && canReview.value) {
      await nextTick();
      approvalPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },
  { immediate: true },
);
</script>

<template>
  <div v-loading="loading">
    <el-result v-if="notFound" icon="warning" :title="t('common.page.notFound.title')">
      <template #extra>
        <el-button @click="back">{{ t('inquiries.detail.back') }}</el-button>
      </template>
    </el-result>

    <template v-if="inquiry">
      <PageHeader :title="`${inquiryNo(inquiry)} · ${inquiry.title}`" :subtitle="inquiry.projectNo">
        <template #actions>
          <el-button icon="Back" @click="back">{{ t('inquiries.detail.back') }}</el-button>
          <el-button
            v-if="can('edit')"
            icon="Edit"
            @click="router.push({ name: 'inquiry-edit', params: { id: inquiry.id } })"
          >
            {{ t('inquiries.detail.actions.edit') }}
          </el-button>
          <el-button v-if="can('submit')" type="primary" icon="Promotion" :loading="acting" @click="submit">
            {{ t('inquiries.detail.actions.submit') }}
          </el-button>
          <el-button v-if="can('publish')" type="primary" icon="Promotion" @click="openPublish">
            {{ t('inquiries.detail.actions.publish') }}
          </el-button>
          <el-button v-if="can('open')" type="primary" icon="Unlock" :loading="acting" @click="openBids">
            {{ t('inquiries.detail.actions.open') }}
          </el-button>
          <el-button
            v-if="can('createChangeRound')"
            icon="DocumentCopy"
            :loading="acting"
            @click="startChange"
          >
            {{ t('inquiries.change.start') }}
          </el-button>
          <el-button
            v-if="can('cancel')"
            type="danger"
            plain
            icon="CircleClose"
            :loading="acting"
            @click="cancel"
          >
            {{ t('inquiries.detail.actions.cancel') }}
          </el-button>
        </template>
      </PageHeader>

      <el-alert
        v-if="inquiry.docStatus === 'CANCELLED'"
        type="info"
        :title="
          t('inquiries.detail.cancelledBanner', {
            time: `${formatDateTime(inquiry.cancelledAt)} ${t('common.tz')}`,
            reason: inquiry.cancelReason,
          })
        "
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        v-else-if="inquiry.award"
        type="success"
        :title="
          t('inquiries.detail.completedBanner', {
            supplier: `${inquiry.award.supplier.code} ${pickName(inquiry.award.supplier, locale)}`,
          })
        "
        show-icon
        :closable="false"
        class="banner completed-banner"
      >
        <div>
          {{
            t('inquiries.detail.completedMeta', {
              name: inquiry.award.awardedBy?.name ?? '—',
              time: `${formatDateTime(inquiry.award.awardedAt)} ${t('common.tz')}`,
            })
          }}
        </div>
        <div v-if="inquiry.award.comment" class="pre">
          {{ t('inquiries.detail.awardComment', { comment: inquiry.award.comment }) }}
        </div>
        <div v-if="inquiry.award.contract">
          {{ t('inquiries.detail.contractDraft', { contractNo: inquiry.award.contract.contractNo }) }}
          <router-link
            v-if="auth.hasPerm('contract:view')"
            :to="{ name: 'contract-detail', params: { id: inquiry.award.contract.id } }"
            class="link contract-link"
          >
            {{ t('inquiries.detail.viewContract') }}
          </router-link>
        </div>
      </el-alert>
      <el-alert
        v-else-if="inquiry.docStatus === 'DRAFT' && inquiry.lastRejectComment"
        type="warning"
        :title="t('inquiries.detail.rejectedBanner', { comment: inquiry.lastRejectComment })"
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        v-else-if="inquiry.docStatus === 'PENDING_APPROVAL'"
        type="warning"
        :title="t('inquiries.detail.pendingBanner')"
        show-icon
        :closable="false"
        class="banner"
      />

      <el-alert
        v-if="inquiry.draftRoundNo"
        type="warning"
        :title="
          t('inquiries.rounds.draftBanner', { no: inquiry.draftRoundNo, current: inquiry.currentRoundNo })
        "
        show-icon
        :closable="false"
        class="banner draft-banner"
      >
        <router-link
          :to="{ name: 'inquiry-change', params: { id: inquiry.id, roundNo: inquiry.draftRoundNo } }"
          class="link"
        >
          {{ t('inquiries.rounds.continueEdit') }}
        </router-link>
      </el-alert>

      <el-card shadow="never" class="qf-card section">
        <el-descriptions :column="3" border>
          <el-descriptions-item :label="t('inquiries.fields.status')">
            <StatusTag enum-name="InquiryDisplayStatus" :value="inquiry.displayStatus" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.formalNo')">{{
            inquiry.formalNo ?? '—'
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.draftNo')">{{
            inquiry.draftNo
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.projectNo')">{{
            inquiry.projectNo
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.materialCategory')">
            {{ pickName(inquiry.materialCategory, locale) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.currency')">
            <DictTag type="currency" :code="inquiry.currency" plain />
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.owner')">{{
            inquiry.owner.name
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.pdUser')">{{
            inquiry.pdUser?.name ?? '—'
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.round')">
            {{ t('inquiries.roundNo', { no: inquiry.currentRoundNo }) }}
            <StatusTag enum-name="RoundStatus" :value="inquiry.currentRoundStatus" class="round-tag" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.deadline')">{{
            deadlineText
          }}</el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.createdBy')">
            {{ inquiry.createdBy.name }} · {{ formatDateTime(inquiry.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.fields.approvedBy')">
            <template v-if="inquiry.approvedBy">
              {{ inquiry.approvedBy.name }} · {{ formatDateTime(inquiry.approvedAt) }}
            </template>
            <template v-else>—</template>
          </el-descriptions-item>
          <el-descriptions-item
            v-if="inquiry.description"
            :label="t('inquiries.fields.description')"
            :span="3"
          >
            <span class="pre">{{ inquiry.description }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="published" shadow="never" class="qf-card section">
        <RoundProgress :round="inquiry.currentRound" />
      </el-card>

      <div v-if="showRounds" class="round-strip">
        <el-radio-group
          :model-value="selectedNo"
          size="small"
          @change="(v: string | number | boolean | undefined) => selectRound(Number(v))"
        >
          <el-radio-button v-for="r in rounds" :key="r.roundNo" :value="r.roundNo">
            {{ roundLabel(r) }}
            <span v-if="r.status === 'SUPERSEDED' || r.status === 'CANCELLED'" class="readonly">
              <el-icon><Lock /></el-icon>{{ t('inquiries.rounds.readonly') }}
            </span>
          </el-radio-button>
        </el-radio-group>
      </div>
      <el-alert
        v-if="viewingOld"
        type="info"
        :title="t('inquiries.rounds.supersededBanner', { no: selectedNo, current: inquiry.currentRoundNo })"
        show-icon
        :closable="false"
        class="banner"
      />
      <el-card v-if="round && round.roundNo > 1" shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.rounds.changeInfo', { no: round.roundNo }) }}</span>
        </template>
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="t('inquiries.change.reason')">
            <span class="pre">{{ round.changeReason }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('inquiries.change.summary')">
            <span class="pre">{{ round.changeSummary }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-collapse v-if="diff" class="diff">
          <el-collapse-item :title="t('roundDiff.title', { from: diff.previousRoundNo, to: diff.roundNo })">
            <RoundDiffTable :diff="diff" />
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <el-tabs v-model="tab">
          <el-tab-pane name="lines" :label="t('inquiries.detail.tabs.lines')">
            <template v-if="round">
              <InquiryLinesTable
                :inquiry-id="inquiry.id"
                :round-no="round.roundNo"
                :lines="round.lines"
                :editable="false"
              />
              <div class="files">
                <InquiryFilesSection :inquiry-id="inquiry.id" :round="round" :editable="false" />
              </div>
            </template>
          </el-tab-pane>
          <el-tab-pane name="invitees" :label="t('inquiries.detail.tabs.invitees')" lazy>
            <InquiryInviteesTab
              :inquiry="inquiry"
              @changed="afterAction"
              @dirty="(value: boolean) => (inviteesDirty = value)"
            />
          </el-tab-pane>
          <el-tab-pane v-if="published" name="responses" :label="t('inquiries.detail.tabs.responses')" lazy>
            <InquiryResponsesTab :inquiry="inquiry" :round-no="selectedNo" @changed="afterAction" />
          </el-tab-pane>
          <el-tab-pane
            v-if="canEvaluate"
            name="evaluation"
            :label="t('inquiries.detail.tabs.evaluation')"
            lazy
          >
            <InquiryEvaluationTab
              :inquiry="inquiry"
              :round-no="selectedNo"
              :refresh-key="matrixRefresh"
              @shortlisted="reloadInquiry"
              @awarded="afterAction"
            />
          </el-tab-pane>
          <el-tab-pane
            v-if="hasShortlist"
            name="negotiation"
            :label="t('inquiries.detail.tabs.negotiation')"
            lazy
          >
            <InquiryNegotiationTab :inquiry="inquiry" :round-no="selectedNo" @changed="matrixRefresh += 1" />
          </el-tab-pane>
          <el-tab-pane name="approvals" :label="t('inquiries.detail.tabs.approvals')">
            <ApprovalTimeline :items="approvals" />
          </el-tab-pane>
          <el-tab-pane
            v-if="can('viewAccessLog')"
            name="accessLogs"
            :label="t('inquiries.detail.tabs.accessLogs')"
            lazy
          >
            <InquiryAccessLogsTab :inquiry="inquiry" />
          </el-tab-pane>
          <el-tab-pane name="logs" :label="t('inquiries.detail.tabs.logs')">
            <InquiryLogs :items="logs" :loading="logsLoading" />
          </el-tab-pane>
        </el-tabs>
      </el-card>

      <div v-if="canReview" ref="approvalPanel">
        <el-card shadow="never" class="qf-card section approval-panel">
          <template #header>
            <span class="section-title">{{ t('inquiries.detail.approvalPanel') }}</span>
          </template>
          <el-input
            v-model="comment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :placeholder="t('inquiries.detail.commentPlaceholder')"
          />
          <div class="approval-actions">
            <el-button v-if="can('reject')" type="danger" plain :loading="acting" @click="reject">
              {{ t('inquiries.detail.reject') }}
            </el-button>
            <el-button v-if="can('approve')" type="primary" :loading="acting" @click="approve">
              {{ t('inquiries.detail.approve') }}
            </el-button>
          </div>
        </el-card>
      </div>

      <PublishDialog v-model="publishVisible" :inquiry="inquiry" @published="onPublished" />
    </template>
  </div>
</template>

<style scoped>
.banner,
.section {
  margin-bottom: 16px;
}
.completed-banner :deep(.el-alert__description) {
  line-height: 1.7;
}
.link {
  color: var(--el-color-primary);
}
.contract-link {
  margin-left: 8px;
}
.round-strip {
  margin-bottom: 12px;
}
.readonly {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}
.diff {
  margin-top: 12px;
  border-top: none;
}
.section-title {
  font-weight: 600;
}
.round-tag {
  margin-left: 6px;
}
.pre {
  white-space: pre-wrap;
}
.files {
  margin-top: 20px;
}
.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
