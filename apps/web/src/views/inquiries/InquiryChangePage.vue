<script setup lang="ts">
import {
  changeRoundSchema,
  CHANGE_REASON_MAX,
  CHANGE_SUMMARY_MAX,
  type InquiryAction,
  type InquiryDetailDto,
  type InquiryRoundDto,
  type RoundDiffDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import ExcelImportDialog from '@/components/ExcelImportDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import RoundDiffTable from '@/components/RoundDiffTable.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { inquiryNo } from '@/utils/inquiries';
import InquiryFilesSection from './InquiryFilesSection.vue';
import InquiryInviteesTab from './InquiryInviteesTab.vue';
import InquiryLinesTable from './InquiryLinesTable.vue';
import ManualLineDialog from './ManualLineDialog.vue';
import MaterialPickerDialog from './MaterialPickerDialog.vue';
import PublishDialog from './PublishDialog.vue';

/**
 * 规格变更编辑页（M13 §5，参考 PPT #12）：左侧"变更说明"（变更原因、主要变更内容），右侧"规格对比（第 N−1 轮 → 第 N 轮）"，
 * 下方是第 N 轮的询价行与附件（按 M06 的规则编辑）和受邀名单（只影响第 N 轮）；底部"放弃变更"和"通知供应商重新报价"
 * （选截止时间发布）。按钮都按变更草稿的 allowedActions 显示
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const id = computed(() => String(route.params.id));
const roundNo = computed(() => Number(route.params.roundNo));
const inquiry = ref<InquiryDetailDto | null>(null);
const round = ref<InquiryRoundDto | null>(null);
const diff = ref<RoundDiffDto | null>(null);
const loading = ref(false);
const savingInfo = ref(false);
const discarding = ref(false);
const publishVisible = ref(false);
const pickerVisible = ref(false);
const addingMaterials = ref(false);
const manualVisible = ref(false);
const importVisible = ref(false);
const inviteesDirty = ref(false);

const info = reactive({ changeReason: '', changeSummary: '' });
const savedInfo = ref('');
const infoDirty = computed(() => JSON.stringify(info) !== savedInfo.value);

const can = (action: InquiryAction) => round.value?.allowedActions.includes(action) ?? false;
const canEditLines = computed(() => can('edit') && auth.hasPerm('inquiry:create'));
const canEditFiles = computed(() => can('edit') && auth.hasPerm('inquiry:spec'));
const canPickMaterials = computed(() => auth.hasPerm('material:view'));
const readonly = computed(() => (round.value?.allowedActions.length ?? 0) === 0);
const params = computed(() => ({ no: roundNo.value, current: inquiry.value?.currentRoundNo ?? 1 }));

function fillInfo(r: InquiryRoundDto): void {
  info.changeReason = r.changeReason ?? '';
  info.changeSummary = r.changeSummary ?? '';
  savedInfo.value = JSON.stringify(info);
}

/** 询价行、附件改动后重新取本轮和规格对比 */
async function reloadRound(): Promise<void> {
  const [r, d] = await Promise.all([
    inquiriesApi.round(id.value, roundNo.value),
    inquiriesApi.roundDiff(id.value, roundNo.value),
  ]);
  round.value = r;
  diff.value = d;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    inquiry.value = await inquiriesApi.get(id.value);
    const r = await inquiriesApi.round(id.value, roundNo.value);
    if (r.status !== 'DRAFT' || r.roundNo < 2) {
      ElMessage.warning(t('inquiries.change.notDraft', { no: roundNo.value }));
      await router.replace({ name: 'inquiry-detail', params: { id: id.value } });
      return;
    }
    round.value = r;
    fillInfo(r);
    diff.value = await inquiriesApi.roundDiff(id.value, roundNo.value);
  } catch (err) {
    ElMessage.error(translateError(apiError(err)));
    await router.replace({ name: 'inquiry-detail', params: { id: id.value } });
  } finally {
    loading.value = false;
  }
}

async function saveInfo(): Promise<boolean> {
  savingInfo.value = true;
  try {
    const updated = await inquiriesApi.updateChangeRound(
      id.value,
      roundNo.value,
      changeRoundSchema.parse({ ...info }),
    );
    round.value = updated;
    fillInfo(updated);
    diff.value = await inquiriesApi.roundDiff(id.value, roundNo.value);
    ElMessage.success(t('inquiries.change.infoSaved'));
    return true;
  } catch {
    return false; // 错误提示由 http 拦截器显示
  } finally {
    savingInfo.value = false;
  }
}

async function discard(): Promise<void> {
  if (!(await confirmAction(t('inquiries.change.discardConfirm', params.value)))) return;
  discarding.value = true;
  try {
    await inquiriesApi.discardChangeRound(id.value, roundNo.value);
    ElMessage.success(t('inquiries.change.discarded'));
    await router.push({ name: 'inquiry-detail', params: { id: id.value } });
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    discarding.value = false;
  }
}

/** R13-3：变更说明要先保存、两项都填；受邀名单要先保存 */
async function openPublish(): Promise<void> {
  if (infoDirty.value) {
    ElMessage.warning(t('inquiries.change.infoUnsaved'));
    return;
  }
  if (!round.value?.changeReason || !round.value.changeSummary) {
    ElMessage.warning(t('inquiries.change.infoRequired'));
    return;
  }
  if (inviteesDirty.value) {
    ElMessage.warning(t('inquiries.publish.saveInviteesFirst'));
    return;
  }
  // 受邀名单可能刚改过，发布对话框按最新的名单显示
  inquiry.value = await inquiriesApi.get(id.value);
  publishVisible.value = true;
}

async function onPublished(): Promise<void> {
  await router.push({ name: 'inquiry-detail', params: { id: id.value }, query: { tab: 'responses' } });
}

async function addMaterials(items: { materialId: string; quantity: string }[]): Promise<void> {
  addingMaterials.value = true;
  try {
    const lines = await inquiriesApi.addFromMaterials(id.value, roundNo.value, items);
    ElMessage.success(t('inquiries.lines.added', { count: lines.length }));
    pickerVisible.value = false;
    await reloadRound();
  } catch (err) {
    ElMessage.error(translateError(apiError(err)));
  } finally {
    addingMaterials.value = false;
  }
}

async function onLineAdded(): Promise<void> {
  ElMessage.success(t('inquiries.lines.added', { count: 1 }));
  await reloadRound();
}

const importLines = (file: File) => inquiriesApi.importLines(id.value, roundNo.value, file);

function back(): void {
  void router.push({ name: 'inquiry-detail', params: { id: id.value } });
}

watch([id, roundNo], load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <template v-if="inquiry && round">
      <PageHeader
        :title="t('inquiries.change.title', { no: roundNo })"
        :subtitle="`${inquiryNo(inquiry)} · ${inquiry.title}`"
      >
        <template #actions>
          <el-button icon="Back" @click="back">{{ t('inquiries.edit.backToDetail') }}</el-button>
        </template>
      </PageHeader>

      <el-alert
        type="info"
        :title="t('inquiries.change.hint', params)"
        show-icon
        :closable="false"
        class="banner"
      />
      <el-alert
        v-if="readonly"
        type="warning"
        :title="t('inquiries.change.noPermission')"
        show-icon
        :closable="false"
        class="banner"
      />

      <el-row :gutter="16" class="section">
        <el-col :span="9">
          <el-card shadow="never" class="qf-card fill">
            <template #header>
              <span class="section-title">{{ t('inquiries.change.info') }}</span>
            </template>
            <el-form label-position="top" :disabled="!can('editChangeRound')" @submit.prevent>
              <el-form-item :label="t('inquiries.change.reason')" required>
                <el-input
                  v-model="info.changeReason"
                  type="textarea"
                  :rows="2"
                  :maxlength="CHANGE_REASON_MAX"
                  show-word-limit
                  :placeholder="t('inquiries.change.reasonPlaceholder')"
                />
              </el-form-item>
              <el-form-item :label="t('inquiries.change.summary')" required>
                <el-input
                  v-model="info.changeSummary"
                  type="textarea"
                  :rows="6"
                  :maxlength="CHANGE_SUMMARY_MAX"
                  show-word-limit
                  :placeholder="t('inquiries.change.summaryPlaceholder')"
                />
              </el-form-item>
            </el-form>
            <div v-if="can('editChangeRound')" class="info-actions">
              <el-button type="primary" plain :disabled="!infoDirty" :loading="savingInfo" @click="saveInfo">
                {{ t('inquiries.change.saveInfo') }}
              </el-button>
            </div>
          </el-card>
        </el-col>
        <el-col :span="15">
          <el-card shadow="never" class="qf-card fill">
            <template #header>
              <span class="section-title">
                {{ t('roundDiff.title', { from: roundNo - 1, to: roundNo }) }}
              </span>
            </template>
            <RoundDiffTable v-if="diff" :diff="diff" />
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <div class="card-header">
            <span class="section-title">
              {{ t('inquiries.change.lines', { no: roundNo }) }}
              <span class="count">{{ t('inquiries.lines.total', { count: round.lines.length }) }}</span>
            </span>
            <div v-if="canEditLines" class="tools">
              <el-button
                v-if="canPickMaterials"
                type="primary"
                plain
                icon="Plus"
                @click="pickerVisible = true"
              >
                {{ t('inquiries.lines.pickMaterials') }}
              </el-button>
              <el-button icon="EditPen" @click="manualVisible = true">{{
                t('inquiries.lines.addManual')
              }}</el-button>
              <el-button icon="Upload" @click="importVisible = true">{{
                t('inquiries.lines.import')
              }}</el-button>
            </div>
          </div>
        </template>
        <InquiryLinesTable
          :inquiry-id="inquiry.id"
          :round-no="roundNo"
          :lines="round.lines"
          :editable="canEditLines"
          @changed="reloadRound"
        />
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.change.files', { no: roundNo }) }}</span>
        </template>
        <InquiryFilesSection
          :inquiry-id="inquiry.id"
          :round="round"
          :editable="canEditFiles"
          @changed="reloadRound"
        />
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.change.invitees', { no: roundNo }) }}</span>
          <span class="hint">{{ t('inquiries.change.inviteesHint', params) }}</span>
        </template>
        <InquiryInviteesTab
          :inquiry="inquiry"
          for-change-round
          @changed="(updated: InquiryDetailDto) => (inquiry = updated)"
          @dirty="(value: boolean) => (inviteesDirty = value)"
        />
      </el-card>

      <div class="footer-bar">
        <el-button
          v-if="can('discardChangeRound')"
          type="danger"
          plain
          icon="Delete"
          :loading="discarding"
          @click="discard"
        >
          {{ t('inquiries.change.discard') }}
        </el-button>
        <el-button v-if="can('publish')" type="primary" icon="Promotion" @click="openPublish">
          {{ t('inquiries.change.publish') }}
        </el-button>
      </div>

      <MaterialPickerDialog v-model="pickerVisible" :saving="addingMaterials" @confirm="addMaterials" />
      <ManualLineDialog
        v-model="manualVisible"
        :inquiry-id="inquiry.id"
        :round-no="roundNo"
        :default-category-id="inquiry.materialCategory.id"
        @saved="onLineAdded"
      />
      <ExcelImportDialog
        v-model="importVisible"
        :title="t('inquiries.lines.importTitle')"
        :template-url="inquiriesApi.lineTemplateUrl"
        :upload="importLines"
        :success-message="(r) => t('inquiries.lines.importSuccess', { created: r.created })"
        @imported="reloadRound"
      />
      <PublishDialog
        v-model="publishVisible"
        :inquiry="inquiry"
        :round-no="roundNo"
        @published="onPublished"
      />
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
.fill {
  height: 100%;
}
.count {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: normal;
}
.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.info-actions {
  display: flex;
  justify-content: flex-end;
}
.footer-bar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0;
}
</style>
