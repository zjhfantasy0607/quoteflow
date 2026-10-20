<script setup lang="ts">
import { isStrongPassword, type RoleDto, type UserDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { rolesApi, usersApi } from '@/api/system';
import DictTag from '@/components/DictTag.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction, promptText } from '@/utils/dialogs';
import { formatDateTime, pickName } from '@/utils/format';
import UserFormDialog from './UserFormDialog.vue';

const { t, locale } = useI18n();
const auth = useAuthStore();

const query = reactive({ keyword: '', status: '' as '' | 'ACTIVE' | 'DISABLED', roleId: '', page: 1, pageSize: 20 });
const rows = ref<UserDto[]>([]);
const total = ref(0);
const loading = ref(false);
const roles = ref<RoleDto[]>([]);
const dialogVisible = ref(false);
const editing = ref<UserDto | null>(null);
const canManage = () => auth.hasPerm('system:user:manage');

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await usersApi.list({
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      roleId: query.roleId || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search(): void {
  query.page = 1;
  void load();
}

function resetQuery(): void {
  Object.assign(query, { keyword: '', status: '', roleId: '', page: 1 });
  void load();
}

function openCreate(): void {
  editing.value = null;
  dialogVisible.value = true;
}

function openEdit(user: UserDto): void {
  editing.value = user;
  dialogVisible.value = true;
}

async function toggleStatus(user: UserDto): Promise<void> {
  const disabling = user.status === 'ACTIVE';
  const ok = await confirmAction(
    t(disabling ? 'system.users.disableConfirm' : 'system.users.enableConfirm', { name: user.name }),
    { type: disabling ? 'warning' : 'info' },
  );
  if (!ok) return;
  await usersApi.setStatus(user.id, disabling ? 'DISABLED' : 'ACTIVE');
  ElMessage.success(t('common.saved'));
  await load();
}

async function resetPassword(user: UserDto): Promise<void> {
  const value = await promptText(t('system.users.resetPasswordPrompt', { name: user.name }), t('system.users.resetPassword'), {
    inputType: 'password',
    inputPlaceholder: t('system.users.passwordRule'),
    inputValidator: (v: string) => isStrongPassword(v) || t('system.users.passwordRule'),
  });
  if (value === null) return;
  await usersApi.resetPassword(user.id, value);
  ElMessage.success(t('system.users.resetPasswordDone'));
}

onMounted(async () => {
  roles.value = await rolesApi.list().catch(() => []);
  await load();
});
</script>

<template>
  <div>
    <PageHeader :title="t('system.users.title')" :subtitle="t('system.users.subtitle')">
      <template #actions>
        <el-button v-perm="'system:user:manage'" type="primary" icon="Plus" @click="openCreate">
          {{ t('system.users.create') }}
        </el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="qf-card">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-input v-model="query.keyword" :placeholder="t('system.users.keywordPlaceholder')" clearable />
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.status" :placeholder="t('system.users.allStatus')" clearable style="width: 140px">
            <el-option value="ACTIVE" :label="t('enums.UserStatus.ACTIVE')" />
            <el-option value="DISABLED" :label="t('enums.UserStatus.DISABLED')" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.roleId" :placeholder="t('system.users.allRoles')" clearable style="width: 160px">
            <el-option
              v-for="r in roles.filter((x) => !x.forSupplier)"
              :key="r.id"
              :value="r.id"
              :label="pickName(r, locale)"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{ t('common.actions.search') }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')">
        <el-table-column prop="username" :label="t('system.users.fields.username')" min-width="140" />
        <el-table-column prop="name" :label="t('system.users.fields.name')" min-width="110" />
        <el-table-column :label="t('system.users.fields.department')" min-width="120">
          <template #default="{ row }"><DictTag type="department" :code="row.departmentCode" plain /></template>
        </el-table-column>
        <el-table-column :label="t('system.users.fields.roles')" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="r in row.roles" :key="r.id" class="role-tag" disable-transitions>{{ pickName(r, locale) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.users.fields.status')" width="100">
          <template #default="{ row }"><StatusTag enum-name="UserStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column :label="t('system.users.fields.lastLoginAt')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column v-if="canManage()" :label="t('common.table.actions')" width="270" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ t('common.actions.edit') }}</el-button>
            <el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" @click="toggleStatus(row)">
              {{ row.status === 'ACTIVE' ? t('system.users.disable') : t('system.users.enable') }}
            </el-button>
            <el-button link type="primary" @click="resetPassword(row)">{{ t('system.users.resetPassword') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>

    <UserFormDialog v-model="dialogVisible" :user="editing" :roles="roles" @saved="load" />
  </div>
</template>

<style scoped>
.role-tag + .role-tag {
  margin-left: 4px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
