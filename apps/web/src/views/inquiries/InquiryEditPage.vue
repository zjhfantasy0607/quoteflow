<script setup lang="ts">
import {
  createInquirySchema,
  updateInquirySchema,
  type InquiryDetailDto,
  type InquiryRoundDto,
  type InquiryUserOptionDto,
  type UserBriefDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictSelect from '@/components/DictSelect.vue';
import ExcelImportDialog from '@/components/ExcelImportDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { inquiryNo } from '@/utils/inquiries';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';
import InquiryFilesSection from './InquiryFilesSection.vue';
import InquiryLinesTable from './InquiryLinesTable.vue';
import ManualLineDialog from './ManualLineDialog.vue';
import MaterialPickerDialog from './MaterialPickerDialog.vue';

/**
 * 新建 / 编辑询价单（M06 §5）：①基本信息 ②询价行 ③规格书与产品图，底部"保存"和"提交审批"。
 * 新建时先保存基本信息（生成草稿号和第 1 轮），再继续添加行和附件。只有草稿能编辑（R06-4）
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isNew = computed(() => id.value === null);
const canEditHeader = computed(() => auth.hasPerm('inquiry:create'));
const canEditLines = computed(() => auth.hasPerm('inquiry:create'));
const canEditFiles = computed(() => auth.hasPerm('inquiry:spec'));
const canPickMaterials = computed(() => auth.hasPerm('material:view'));

const inquiry = ref<InquiryDetailDto | null>(null);
const round = ref<InquiryRoundDto | null>(null);
const users = ref<InquiryUserOptionDto[]>([]);
const loading = ref(false);
const saving = ref(false);
const submitting = ref(false);
const errors = ref<FieldErrors>({});
const pickerVisible = ref(false);
const addingMaterials = ref(false);
const manualVisible = ref(false);
const importVisible = ref(false);

/** 后端错误码 → 表单字段 */
const FIELD_OF_ERROR: Record<string, string> = {
  CATEGORY_DISABLED: 'materialCategoryId',
  DICT_ITEM_INVALID: 'currency',
};

const emptyForm = () => ({
  projectNo: '',
  title: '',
  materialCategoryId: null as string | null,
  currency: 'CNY' as string | null,
  ownerId: (auth.me?.user.id ?? null) as string | null,
  pdUserId: null as string | null,
  description: '',
});
const form = reactive(emptyForm());
const savedForm = ref(JSON.stringify(form));
const dirty = computed(() => JSON.stringify(form) !== savedForm.value);

const roundEditable = computed(() => round.value?.allowedActions.includes('edit') ?? false);
const canSubmit = computed(() => inquiry.value?.allowedActions.includes('submit') ?? false);

/** 候选人之外的现有负责人（如已停用）也要能显示出来 */
function withCurrent(current: UserBriefDto | null | undefined): { id: string; label: string }[] {
  const options = users.value.map((u) => ({
    id: u.id,
    label: t('inquiries.edit.userOption', { name: u.name, username: u.username }),
  }));
  if (current && !options.some((o) => o.id === current.id))
    options.unshift({ id: current.id, label: current.name });
  return options;
}
const ownerOptions = computed(() => withCurrent(inquiry.value?.owner));
const pdOptions = computed(() => withCurrent(inquiry.value?.pdUser));

function fill(d: InquiryDetailDto): void {
  Object.assign(form, {
    projectNo: d.projectNo,
    title: d.title,
    materialCategoryId: d.materialCategory.id,
    currency: d.currency,
    ownerId: d.owner.id,
    pdUserId: d.pdUser?.id ?? null,
    description: d.description ?? '',
  });
  savedForm.value = JSON.stringify(form);
}

async function loadRound(): Promise<void> {
  if (!inquiry.value) return;
  round.value = await inquiriesApi.round(inquiry.value.id, inquiry.value.currentRoundNo);
}

async function load(): Promise<void> {
  errors.value = {};
  if (!id.value) {
    inquiry.value = null;
    round.value = null;
    Object.assign(form, emptyForm());
    savedForm.value = JSON.stringify(form);
    return;
  }
  loading.value = true;
  try {
    const detail = await inquiriesApi.get(id.value);
    if (!detail.allowedActions.includes('edit')) {
      ElMessage.warning(t('inquiries.edit.notEditable'));
      await router.replace({ name: 'inquiry-detail', params: { id: detail.id } });
      return;
    }
    inquiry.value = detail;
    fill(detail);
    await loadRound();
  } catch (err) {
    ElMessage.error(translateError(apiError(err)));
    await router.replace({ name: 'inquiries' });
  } finally {
    loading.value = false;
  }
}

function headerPayload() {
  return {
    projectNo: form.projectNo,
    title: form.title,
    materialCategoryId: form.materialCategoryId ?? '',
    currency: form.currency ?? '',
    description: form.description,
    ownerId: form.ownerId ?? '',
    pdUserId: form.pdUserId,
  };
}

/** 保存基本信息；新建成功后转到编辑地址，继续添加行和附件 */
async function saveHeader(): Promise<boolean> {
  const data = headerPayload();
  const schema = isNew.value ? createInquirySchema : updateInquirySchema;
  errors.value = zodErrors(schema, data);
  if (Object.keys(errors.value).length > 0) return false;
  saving.value = true;
  try {
    if (isNew.value) {
      const created = await inquiriesApi.create(createInquirySchema.parse(data));
      savedForm.value = JSON.stringify(form);
      ElMessage.success(t('common.saved'));
      await router.replace({ name: 'inquiry-edit', params: { id: created.id } });
    } else {
      const updated = await inquiriesApi.update(id.value!, updateInquirySchema.parse(data));
      inquiry.value = updated;
      fill(updated);
      ElMessage.success(t('common.saved'));
    }
    return true;
  } catch (err) {
    const body = apiError(err);
    const field = body?.code ? FIELD_OF_ERROR[body.code] : undefined;
    if (field) errors.value = { [field]: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
    return false;
  } finally {
    saving.value = false;
  }
}

async function submit(): Promise<void> {
  if (!inquiry.value) return;
  if (dirty.value && canEditHeader.value && !(await saveHeader())) return;
  if (!(await confirmAction(t('inquiries.edit.submitConfirm'), { type: 'info' }))) return;
  submitting.value = true;
  try {
    await inquiriesApi.submit(inquiry.value.id);
  } catch {
    return; // 错误提示由 http 拦截器显示
  } finally {
    submitting.value = false;
  }
  ElMessage.success(t('inquiries.edit.submitted'));
  await router.push({ name: 'inquiry-detail', params: { id: inquiry.value.id } });
}

async function addMaterials(items: { materialId: string; quantity: string }[]): Promise<void> {
  if (!inquiry.value) return;
  addingMaterials.value = true;
  try {
    const lines = await inquiriesApi.addFromMaterials(inquiry.value.id, inquiry.value.currentRoundNo, items);
    ElMessage.success(t('inquiries.lines.added', { count: lines.length }));
    pickerVisible.value = false;
    await loadRound();
  } catch (err) {
    ElMessage.error(translateError(apiError(err)));
  } finally {
    addingMaterials.value = false;
  }
}

async function onLineAdded(): Promise<void> {
  ElMessage.success(t('inquiries.lines.added', { count: 1 }));
  await loadRound();
}

const importLines = (file: File) =>
  inquiriesApi.importLines(inquiry.value!.id, inquiry.value!.currentRoundNo, file);

function back(): void {
  if (inquiry.value) void router.push({ name: 'inquiry-detail', params: { id: inquiry.value.id } });
  else void router.push({ name: 'inquiries' });
}

watch(id, load, { immediate: true });
onMounted(async () => {
  if (canEditHeader.value) users.value = await inquiriesApi.userOptions().catch(() => []);
});
</script>

<template>
  <div v-loading="loading">
    <PageHeader
      :title="isNew ? t('inquiries.edit.newTitle') : t('inquiries.edit.editTitle')"
      :subtitle="inquiry ? `${inquiryNo(inquiry)} · ${inquiry.title}` : undefined"
    >
      <template #actions>
        <el-button icon="Back" @click="back">
          {{ inquiry ? t('inquiries.edit.backToDetail') : t('common.actions.back') }}
        </el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="inquiry?.lastRejectComment"
      type="warning"
      :title="t('inquiries.edit.rejectedBanner', { comment: inquiry.lastRejectComment })"
      show-icon
      :closable="false"
      class="banner"
    />

    <el-card shadow="never" class="qf-card section">
      <template #header>
        <span class="section-title">{{ t('inquiries.edit.sectionBasic') }}</span>
      </template>
      <el-form label-width="auto" class="basic-form" :disabled="!canEditHeader" @submit.prevent="saveHeader">
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item :label="t('inquiries.fields.projectNo')" :error="errors.projectNo" required>
              <el-input v-model="form.projectNo" maxlength="50" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('inquiries.fields.title')" :error="errors.title" required>
              <el-input v-model="form.title" maxlength="200" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item
              :label="t('inquiries.fields.materialCategory')"
              :error="errors.materialCategoryId"
              required
            >
              <CategoryTreeSelect v-model="form.materialCategoryId" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('inquiries.fields.currency')" :error="errors.currency" required>
              <DictSelect v-model="form.currency" type="currency" :clearable="false" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('inquiries.fields.owner')" :error="errors.ownerId" required>
              <el-select v-model="form.ownerId" filterable style="width: 100%">
                <el-option v-for="o in ownerOptions" :key="o.id" :value="o.id" :label="o.label" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('inquiries.fields.pdUser')" :error="errors.pdUserId">
              <el-select
                v-model="form.pdUserId"
                filterable
                clearable
                :placeholder="t('inquiries.edit.pdPlaceholder')"
                style="width: 100%"
              >
                <el-option v-for="o in pdOptions" :key="o.id" :value="o.id" :label="o.label" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item :label="t('inquiries.fields.description')" :error="errors.description">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                maxlength="1000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <template v-if="inquiry && round">
      <el-card shadow="never" class="qf-card section">
        <template #header>
          <div class="card-header">
            <span class="section-title">
              {{ t('inquiries.edit.sectionLines') }}
              <span class="count">{{ t('inquiries.lines.total', { count: round.lines.length }) }}</span>
            </span>
            <div v-if="roundEditable && canEditLines" class="tools">
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
        <el-alert
          v-if="!canEditLines"
          type="info"
          :title="t('inquiries.edit.noLinePermission')"
          :closable="false"
          class="banner"
        />
        <InquiryLinesTable
          :inquiry-id="inquiry.id"
          :round-no="round.roundNo"
          :lines="round.lines"
          :editable="roundEditable && canEditLines"
          @changed="loadRound"
        />
      </el-card>

      <el-card shadow="never" class="qf-card section">
        <template #header>
          <span class="section-title">{{ t('inquiries.edit.sectionFiles') }}</span>
        </template>
        <el-alert
          v-if="!canEditFiles"
          type="info"
          :title="t('inquiries.edit.noFilePermission')"
          :closable="false"
          class="banner"
        />
        <InquiryFilesSection
          :inquiry-id="inquiry.id"
          :round="round"
          :editable="roundEditable && canEditFiles"
          @changed="loadRound"
        />
      </el-card>
    </template>
    <el-alert
      v-else-if="isNew"
      type="info"
      :title="t('inquiries.edit.saveFirst')"
      :closable="false"
      show-icon
      class="banner"
    />

    <div class="footer-bar">
      <el-button
        v-if="canEditHeader"
        :type="isNew ? 'primary' : 'default'"
        :loading="saving"
        @click="saveHeader"
      >
        {{ isNew ? t('inquiries.edit.saveDraft') : t('common.actions.save') }}
      </el-button>
      <el-button v-if="canSubmit" type="primary" :loading="submitting" @click="submit">
        {{ t('inquiries.edit.submit') }}
      </el-button>
    </div>

    <template v-if="inquiry">
      <MaterialPickerDialog v-model="pickerVisible" :saving="addingMaterials" @confirm="addMaterials" />
      <ManualLineDialog
        v-model="manualVisible"
        :inquiry-id="inquiry.id"
        :round-no="inquiry.currentRoundNo"
        :default-category-id="form.materialCategoryId"
        @saved="onLineAdded"
      />
      <ExcelImportDialog
        v-model="importVisible"
        :title="t('inquiries.lines.importTitle')"
        :template-url="inquiriesApi.lineTemplateUrl"
        :upload="importLines"
        :success-message="(r) => t('inquiries.lines.importSuccess', { created: r.created })"
        @imported="loadRound"
      />
    </template>
  </div>
</template>

<style scoped>
.banner {
  margin-bottom: 16px;
}
.section {
  margin-bottom: 16px;
}
.section-title {
  font-weight: 600;
}
.count {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: normal;
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
.footer-bar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0;
}
</style>
