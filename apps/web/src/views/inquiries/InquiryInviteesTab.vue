<script setup lang="ts">
import type { InquiryDetailDto, InquiryInviteeDto, InviteeSupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import StatusTag from '@/components/StatusTag.vue';
import SupplierCategoryTag from '@/components/SupplierCategoryTag.vue';
import { formatDateTime, pickName } from '@/utils/format';
import { supplierLanguageLabel } from '@/utils/suppliers';
import InviteeCandidatesTable from './InviteeCandidatesTable.vue';
import LateInviteDialog from './LateInviteDialog.vue';

/**
 * "邀请供应商"页签（M07 §5）：第 1 轮发布前（editInvitees）上方筛选、下方勾选候选供应商，右侧是已选名单，
 * 保存后整体替换；发布后变为只读名单 +"补充邀请"。
 * M13：有变更草稿时名单只影响下一轮——详情页仍按当前轮显示（只读 + 补充邀请），变更编辑页传 forChangeRound 在那里维护
 */
const props = defineProps<{ inquiry: InquiryDetailDto; forChangeRound?: boolean }>();
const emit = defineEmits<{ changed: [InquiryDetailDto]; dirty: [boolean] }>();

const { t, locale } = useI18n();

const invitees = ref<InquiryInviteeDto[]>([]);
const selected = ref<InviteeSupplierDto[]>([]);
const loading = ref(false);
const saving = ref(false);
const lateVisible = ref(false);
const candidates = ref<InstanceType<typeof InviteeCandidatesTable> | null>(null);

const editable = computed(
  () =>
    props.inquiry.allowedActions.includes('editInvitees') &&
    (props.forChangeRound || !props.inquiry.draftRoundNo),
);
const canLateInvite = computed(
  () => !props.forChangeRound && props.inquiry.allowedActions.includes('lateInvite'),
);
const savedIds = computed(() => invitees.value.map((i) => i.supplier.id));
const dirty = computed(() => {
  const saved = new Set(savedIds.value);
  return selected.value.length !== saved.size || selected.value.some((s) => !saved.has(s.id));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    invitees.value = await inquiriesApi.invitees(props.inquiry.id);
    selected.value = invitees.value.map((i) => i.supplier);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    invitees.value = await inquiriesApi.saveInvitees(
      props.inquiry.id,
      selected.value.map((s) => s.id),
    );
    selected.value = invitees.value.map((i) => i.supplier);
    ElMessage.success(t('inquiries.invitees.saved', { count: invitees.value.length }));
    await candidates.value?.reload();
  } catch {
    // 错误提示由 http 拦截器显示
  } finally {
    saving.value = false;
  }
}

function revert(): void {
  selected.value = invitees.value.map((i) => i.supplier);
}

function remove(id: string): void {
  selected.value = selected.value.filter((s) => s.id !== id);
}

const mainCategories = (s: InviteeSupplierDto) =>
  s.materialCategories.map((c) => pickName(c, locale.value)).join(t('common.listSeparator'));

watch(dirty, (value) => emit('dirty', value));
// 动作接口返回新的详情（发布、补充邀请、取消……）时重新取名单
watch(() => props.inquiry, load, { immediate: true });
</script>

<template>
  <div v-loading="loading">
    <template v-if="editable">
      <el-alert
        v-if="inquiry.docStatus === 'DRAFT'"
        type="info"
        :title="t('inquiries.invitees.draftHint')"
        show-icon
        :closable="false"
        class="hint"
      />
      <div class="layout">
        <div class="candidates">
          <InviteeCandidatesTable
            ref="candidates"
            v-model="selected"
            :inquiry-id="inquiry.id"
            :default-material-category-id="inquiry.materialCategory.id"
          />
        </div>
        <div class="panel">
          <div class="panel-title">
            {{ t('inquiries.invitees.selectedCount', { count: selected.length }) }}
          </div>
          <div class="tags">
            <el-tag
              v-for="s in selected"
              :key="s.id"
              closable
              :type="s.status === 'DISABLED' ? 'danger' : 'info'"
              disable-transitions
              @close="remove(s.id)"
            >
              {{
                s.status === 'DISABLED'
                  ? t('inquiries.invitees.disabledName', { name: pickName(s, locale) })
                  : pickName(s, locale)
              }}
            </el-tag>
            <div v-if="selected.length === 0" class="none">{{ t('inquiries.invitees.noneSelected') }}</div>
          </div>
          <div v-if="dirty" class="dirty">{{ t('inquiries.invitees.unsaved') }}</div>
          <div class="panel-actions">
            <el-button :disabled="!dirty" @click="revert">{{ t('inquiries.invitees.revert') }}</el-button>
            <el-button type="primary" :disabled="!dirty" :loading="saving" @click="save">
              {{ t('inquiries.invitees.save') }}
            </el-button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="toolbar">
        <span class="total">{{ t('inquiries.invitees.total', { count: invitees.length }) }}</span>
        <el-button v-if="canLateInvite" type="primary" icon="Plus" @click="lateVisible = true">
          {{ t('inquiries.invitees.lateInvite') }}
        </el-button>
      </div>
      <el-table :data="invitees" :empty-text="t('inquiries.invitees.empty')">
        <el-table-column :label="t('inquiries.invitees.fields.code')" width="130">
          <template #default="{ row }">{{ row.supplier.code }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.invitees.fields.name')" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ pickName(row.supplier, locale) }}
            <el-tag v-if="row.supplier.status === 'DISABLED'" size="small" type="danger" class="off">
              {{ t('inquiries.invitees.disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.invitees.fields.category')" width="120">
          <template #default="{ row }"><SupplierCategoryTag :code="row.supplier.categoryCode" /></template>
        </el-table-column>
        <el-table-column
          :label="t('inquiries.invitees.fields.materialCategories')"
          min-width="150"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ mainCategories(row.supplier) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.invitees.fields.language')" width="130">
          <template #default="{ row }">{{ supplierLanguageLabel(row.supplier.preferredLanguage) }}</template>
        </el-table-column>
        <el-table-column :label="t('inquiries.invitees.fields.portalAccount')" width="140">
          <template #default="{ row }">
            <StatusTag enum-name="PortalAccountState" :value="row.supplier.portalAccount" />
          </template>
        </el-table-column>
        <el-table-column :label="t('inquiries.invitees.fields.addedBy')" width="180">
          <template #default="{ row }">{{ row.addedBy.name }} · {{ formatDateTime(row.addedAt) }}</template>
        </el-table-column>
      </el-table>
    </template>

    <LateInviteDialog
      v-model="lateVisible"
      :inquiry="inquiry"
      :invited-ids="savedIds"
      @invited="(updated) => emit('changed', updated)"
    />
  </div>
</template>

<style scoped>
.hint {
  margin-bottom: 12px;
}
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.candidates {
  flex: 1;
  min-width: 0;
}
.panel {
  flex: 0 0 280px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 12px;
}
.panel-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}
.none {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.dirty {
  margin-top: 10px;
  color: var(--el-color-warning);
  font-size: 13px;
}
.panel-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.total {
  color: var(--el-text-color-secondary);
}
.off {
  margin-left: 6px;
}
</style>
