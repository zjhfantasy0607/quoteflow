<script setup lang="ts">
import type { SupplierAccountDto, SupplierDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiError } from '@/api/http';
import { supplierAccountsApi, suppliersApi } from '@/api/suppliers';
import MaskedValue from '@/components/MaskedValue.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import SupplierCategoryTag from '@/components/SupplierCategoryTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime, pickName } from '@/utils/format';
import { isMasked } from '@/utils/masked';
import { supplierLanguageLabel } from '@/utils/suppliers';
import SupplierAccountDialog from './SupplierAccountDialog.vue';
import SupplierFormDialog from './SupplierFormDialog.vue';
import SupplierPointsTab from './SupplierPointsTab.vue';
import SupplierQuotesTab from './SupplierQuotesTab.vue';

/** 供应商详情：基本信息 + 门户账号（R04-10）、报价记录、积分（R15-4）页签；?tab= 打开指定页签 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canManage = computed(() => auth.hasPerm('supplier:manage'));
const canManageAccounts = computed(() => auth.hasPerm('supplier:account'));

const id = computed(() => String(route.params.id));
const supplier = ref<SupplierDto | null>(null);
const notFound = ref(false);
const loading = ref(false);
const accounts = ref<SupplierAccountDto[]>([]);
const accountsLoading = ref(false);
const TABS = ['accounts', 'quotes', 'points'];
const tab = ref(TABS.includes(String(route.query.tab)) ? String(route.query.tab) : 'accounts');
const formVisible = ref(false);
const accountVisible = ref(false);

const name = computed(() => (supplier.value ? pickName(supplier.value, locale.value) : ''));
const masked = computed(() => !!supplier.value?.maskedFields?.length);

async function load(): Promise<void> {
  loading.value = true;
  try {
    supplier.value = await suppliersApi.get(id.value);
    notFound.value = false;
  } catch (err) {
    notFound.value = apiError(err)?.code === 'NOT_FOUND';
  } finally {
    loading.value = false;
  }
}

async function loadAccounts(): Promise<void> {
  accountsLoading.value = true;
  try {
    accounts.value = await supplierAccountsApi.list(id.value);
  } finally {
    accountsLoading.value = false;
  }
}

async function toggleStatus(): Promise<void> {
  const s = supplier.value!;
  const disabling = s.status === 'ENABLED';
  const message = t(disabling ? 'suppliers.list.disableConfirm' : 'suppliers.list.enableConfirm', {
    name: name.value,
  });
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  try {
    supplier.value = await suppliersApi.setStatus(s.id, disabling ? 'DISABLED' : 'ENABLED');
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('common.saved'));
}

async function resend(account: SupplierAccountDto): Promise<void> {
  if (!(await confirmAction(t('suppliers.accounts.resendConfirm', { name: account.name }), { type: 'info' })))
    return;
  try {
    await supplierAccountsApi.resendActivation(id.value, account.id);
  } catch {
    return;
  }
  ElMessage.success(t('suppliers.accounts.resent'));
  await loadAccounts();
}

async function toggleAccount(account: SupplierAccountDto): Promise<void> {
  const disabling = account.status !== 'DISABLED';
  const message = t(disabling ? 'suppliers.accounts.disableConfirm' : 'suppliers.accounts.enableConfirm', {
    name: account.name,
  });
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  try {
    await supplierAccountsApi.setStatus(id.value, account.id, disabling ? 'DISABLED' : 'ACTIVE');
  } catch {
    return;
  }
  ElMessage.success(t('common.saved'));
  await loadAccounts();
}

const expired = (account: SupplierAccountDto) =>
  !!account.activationExpiresAt && new Date(account.activationExpiresAt).getTime() <= Date.now();

watch(
  id,
  () => {
    supplier.value = null;
    accounts.value = [];
    void load();
    void loadAccounts();
  },
  { immediate: true },
);
</script>

<template>
  <div v-loading="loading">
    <template v-if="supplier">
      <PageHeader :title="name" :subtitle="supplier.code">
        <template #actions>
          <el-button icon="Back" @click="router.push({ name: 'suppliers' })">
            {{ t('suppliers.detail.back') }}
          </el-button>
          <template v-if="canManage">
            <el-tooltip :disabled="!masked" :content="t('suppliers.list.maskedEditHint')" placement="top">
              <span>
                <el-button type="primary" icon="Edit" :disabled="masked" @click="formVisible = true">
                  {{ t('common.actions.edit') }}
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              :type="supplier.status === 'ENABLED' ? 'danger' : 'success'"
              plain
              @click="toggleStatus"
            >
              {{ supplier.status === 'ENABLED' ? t('suppliers.list.disable') : t('suppliers.list.enable') }}
            </el-button>
          </template>
        </template>
      </PageHeader>

      <el-alert
        v-if="supplier.status === 'DISABLED'"
        :title="t('suppliers.detail.disabledBanner')"
        type="warning"
        show-icon
        :closable="false"
        class="banner"
      />

      <el-card shadow="never" class="qf-card">
        <template #header>{{ t('suppliers.detail.basic') }}</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="t('suppliers.list.fields.code')">
            {{ supplier.code }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.category')">
            <SupplierCategoryTag :code="supplier.categoryCode" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.nameZh')">
            {{ supplier.nameZh }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.nameEn')">
            {{ supplier.nameEn }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.creditCode')">
            {{ supplier.creditCode }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.status')">
            <StatusTag enum-name="EnableStatus" :value="supplier.status" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.materialCategories')" :span="2">
            <el-tag
              v-for="c in supplier.materialCategories"
              :key="c.id"
              :type="c.effectiveEnabled ? 'primary' : 'info'"
              class="category-tag"
              disable-transitions
            >
              {{ pickName(c, locale) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.contactName')">
            {{ supplier.contactName }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.contactPhone')">
            <MaskedValue :masked="isMasked(supplier, 'contactPhone')">
              {{ supplier.contactPhone }}
            </MaskedValue>
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.contactEmail')">
            <MaskedValue :masked="isMasked(supplier, 'contactEmail')">
              {{ supplier.contactEmail }}
            </MaskedValue>
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.ccEmails')">
            <MaskedValue :masked="isMasked(supplier, 'ccEmails')">
              {{ supplier.ccEmails?.join(', ') }}
            </MaskedValue>
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.language')">
            {{ supplierLanguageLabel(supplier.preferredLanguage) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.country')">
            {{ supplier.country }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.address')" :span="2">
            {{ supplier.address }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.remark')" :span="2">
            {{ supplier.remark }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.createdAt')">
            {{ formatDateTime(supplier.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('suppliers.list.fields.updatedAt')">
            {{ formatDateTime(supplier.updatedAt) }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" class="qf-card tabs-card">
        <el-tabs v-model="tab">
          <el-tab-pane :label="t('suppliers.detail.tabs.accounts')" name="accounts">
            <div v-if="canManageAccounts" class="toolbar">
              <el-tooltip
                :disabled="supplier.status === 'ENABLED'"
                :content="t('suppliers.accounts.supplierDisabled')"
              >
                <span>
                  <el-button
                    type="primary"
                    icon="Plus"
                    :disabled="supplier.status !== 'ENABLED'"
                    @click="accountVisible = true"
                  >
                    {{ t('suppliers.accounts.create') }}
                  </el-button>
                </span>
              </el-tooltip>
            </div>
            <el-table
              v-loading="accountsLoading"
              :data="accounts"
              :empty-text="t('suppliers.accounts.empty')"
            >
              <el-table-column :label="t('suppliers.accounts.fields.username')" min-width="220">
                <template #default="{ row }">
                  <MaskedValue :masked="isMasked(row, 'username')">{{ row.username }}</MaskedValue>
                </template>
              </el-table-column>
              <el-table-column prop="name" :label="t('suppliers.accounts.fields.name')" min-width="120" />
              <el-table-column :label="t('suppliers.accounts.fields.status')" width="100">
                <template #default="{ row }">
                  <StatusTag enum-name="UserStatus" :value="row.status" />
                </template>
              </el-table-column>
              <el-table-column :label="t('suppliers.accounts.fields.activation')" min-width="190">
                <template #default="{ row }">
                  <template v-if="row.activationExpiresAt">
                    <el-text v-if="expired(row)" type="danger">{{ t('suppliers.accounts.expired') }}</el-text>
                    <span v-else>
                      {{
                        t('suppliers.accounts.validUntil', { time: formatDateTime(row.activationExpiresAt) })
                      }}
                    </span>
                  </template>
                </template>
              </el-table-column>
              <el-table-column :label="t('suppliers.accounts.fields.lastLoginAt')" width="150">
                <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
              </el-table-column>
              <el-table-column :label="t('suppliers.accounts.fields.createdAt')" width="150">
                <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column
                v-if="canManageAccounts"
                :label="t('common.table.actions')"
                width="200"
                fixed="right"
              >
                <template #default="{ row }">
                  <el-button
                    v-if="row.status === 'PENDING_ACTIVATION'"
                    link
                    type="primary"
                    :disabled="supplier.status !== 'ENABLED'"
                    @click="resend(row)"
                  >
                    {{ t('suppliers.accounts.resend') }}
                  </el-button>
                  <el-button
                    link
                    :type="row.status === 'DISABLED' ? 'success' : 'danger'"
                    @click="toggleAccount(row)"
                  >
                    {{
                      row.status === 'DISABLED'
                        ? t('suppliers.accounts.enable')
                        : t('suppliers.accounts.disable')
                    }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="t('suppliers.detail.tabs.quotes')" name="quotes" lazy>
            <SupplierQuotesTab :key="supplier.id" :supplier-id="supplier.id" />
          </el-tab-pane>
          <el-tab-pane :label="t('suppliers.detail.tabs.points')" name="points" lazy>
            <SupplierPointsTab :key="supplier.id" :supplier="supplier" />
          </el-tab-pane>
        </el-tabs>
      </el-card>

      <SupplierFormDialog v-model="formVisible" :supplier="supplier" @saved="(s) => (supplier = s)" />
      <SupplierAccountDialog v-model="accountVisible" :supplier="supplier" @created="loadAccounts" />
    </template>

    <el-result v-else-if="notFound" icon="warning" :title="t('common.page.notFound.title')">
      <template #extra>
        <el-button type="primary" @click="router.push({ name: 'suppliers' })">
          {{ t('suppliers.detail.back') }}
        </el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.banner {
  margin-bottom: 16px;
}
.tabs-card {
  margin-top: 16px;
}
.toolbar {
  margin-bottom: 12px;
}
.category-tag {
  margin-right: 6px;
}
</style>
