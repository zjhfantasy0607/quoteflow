<script setup lang="ts">
import {
  createRoleSchema,
  SUPPLIER_ROLE_CODE,
  updateRoleSchema,
  type DataScope,
  type PermissionCatalogDto,
  type RoleDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { rolesApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { confirmAction } from '@/utils/dialogs';
import { pickLabel, pickName } from '@/utils/format';
import { zodErrors, type FieldErrors } from '@/utils/validate';

const { t, locale } = useI18n();
const auth = useAuthStore();

const catalog = ref<PermissionCatalogDto | null>(null);
const roles = ref<RoleDto[]>([]);
const keyword = ref('');
const selectedId = ref<string | null>(null);
const creating = ref(false);
const tab = ref<'functions' | 'data' | 'fields'>('functions');
const saving = ref(false);
const errors = ref<FieldErrors>({});

const form = reactive({
  code: '',
  nameZh: '',
  nameEn: '',
  description: '',
  dataScope: 'SELF' as DataScope,
  permissions: [] as string[],
  fieldPermissions: [] as string[],
});

const canManage = computed(() => auth.hasPerm('system:role:manage'));
const selected = computed(() => roles.value.find((r) => r.id === selectedId.value) ?? null);
const isSupplierRole = computed(() => selected.value?.code === SUPPLIER_ROLE_CODE);
const readonly = computed(() => !canManage.value);
const permsLocked = computed(() => readonly.value || isSupplierRole.value);
const showEditor = computed(() => creating.value || selected.value !== null);
const filteredRoles = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return k
    ? roles.value.filter((r) => [r.code, r.nameZh, r.nameEn].some((v) => v.toLowerCase().includes(k)))
    : roles.value;
});
const dataScopes: DataScope[] = ['SELF', 'DEPT', 'ALL'];

function fill(role: RoleDto | null): void {
  errors.value = {};
  Object.assign(form, {
    code: role?.code ?? '',
    nameZh: role?.nameZh ?? '',
    nameEn: role?.nameEn ?? '',
    description: role?.description ?? '',
    dataScope: role?.dataScope ?? 'SELF',
    permissions: [...(role?.permissions ?? [])],
    fieldPermissions: [...(role?.fieldPermissions ?? [])],
  });
}

function select(role: RoleDto): void {
  creating.value = false;
  selectedId.value = role.id;
  fill(role);
}

function startCreate(): void {
  creating.value = true;
  selectedId.value = null;
  fill(null);
  tab.value = 'functions';
}

function moduleCodes(key: string): string[] {
  return catalog.value?.modules.find((m) => m.key === key)?.permissions.map((p) => p.code) ?? [];
}

function moduleState(key: string): { all: boolean; some: boolean } {
  const codes = moduleCodes(key);
  const count = codes.filter((c) => form.permissions.includes(c)).length;
  return { all: count === codes.length && count > 0, some: count > 0 && count < codes.length };
}

function toggleModule(key: string, checked: boolean): void {
  const codes = moduleCodes(key);
  form.permissions = checked
    ? [...new Set([...form.permissions, ...codes])]
    : form.permissions.filter((c) => !codes.includes(c));
}

async function load(selectId?: string): Promise<void> {
  roles.value = await rolesApi.list();
  const target = roles.value.find((r) => r.id === (selectId ?? selectedId.value)) ?? roles.value[0] ?? null;
  if (target && !creating.value) select(target);
}

async function save(): Promise<void> {
  const body = {
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    description: form.description,
    dataScope: form.dataScope,
    permissions: form.permissions,
    fieldPermissions: form.fieldPermissions,
  };
  const schema = creating.value ? createRoleSchema : updateRoleSchema;
  const data = creating.value ? { ...body, code: form.code } : body;
  errors.value = zodErrors(schema, data);
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = creating.value
      ? await rolesApi.create(createRoleSchema.parse(data))
      : await rolesApi.update(selectedId.value!, updateRoleSchema.parse(data));
    creating.value = false;
    ElMessage.success(t('system.roles.saved'));
    await load(saved.id);
    // 改的可能是自己的角色：刷新当前用户权限，菜单立即变化
    await auth.fetchMe();
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'ROLE_CODE_TAKEN') errors.value = { code: translateError(body) };
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const role = selected.value;
  if (!role || !(await confirmAction(t('system.roles.deleteConfirm', { name: pickName(role, locale.value) })))) return;
  await rolesApi.remove(role.id);
  ElMessage.success(t('system.roles.deleted'));
  selectedId.value = null;
  await load();
}

function cancel(): void {
  if (creating.value) {
    creating.value = false;
    if (roles.value[0]) select(roles.value[0]);
  } else {
    fill(selected.value);
  }
}

onMounted(async () => {
  catalog.value = await rolesApi.catalog();
  await load();
});
</script>

<template>
  <div>
    <PageHeader :title="t('system.roles.title')" :subtitle="t('system.roles.subtitle')">
      <template #actions>
        <el-button v-perm="'system:role:manage'" type="primary" icon="Plus" @click="startCreate">
          {{ t('system.roles.create') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="roles-layout">
      <el-card shadow="never" class="role-list" body-style="padding: 12px">
        <el-input v-model="keyword" :placeholder="t('system.roles.searchPlaceholder')" prefix-icon="Search" clearable />
        <ul class="items">
          <li
            v-for="r in filteredRoles"
            :key="r.id"
            :class="{ active: r.id === selectedId && !creating }"
            @click="select(r)"
          >
            <el-icon><UserFilled /></el-icon>
            <span class="name">{{ pickName(r, locale) }}</span>
            <el-tag v-if="r.isPreset" size="small" type="info" disable-transitions>{{ t('system.roles.preset') }}</el-tag>
            <span class="count">{{ t('system.roles.userCount', { count: r.userCount }) }}</span>
          </li>
        </ul>
      </el-card>

      <el-card shadow="never" class="role-detail">
        <el-empty v-if="!showEditor" :description="t('system.roles.empty')" />
        <template v-else>
          <el-form label-width="auto" :disabled="readonly" class="basic">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item :label="t('system.roles.fields.code')" :error="errors.code" required>
                  <el-input v-model="form.code" :disabled="!creating" :placeholder="t('system.roles.codeRule')" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item :label="t('system.roles.fields.description')" :error="errors.description">
                  <el-input v-model="form.description" maxlength="200" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item :label="t('system.roles.fields.nameZh')" :error="errors.nameZh" required>
                  <el-input v-model="form.nameZh" maxlength="50" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item :label="t('system.roles.fields.nameEn')" :error="errors.nameEn" required>
                  <el-input v-model="form.nameEn" maxlength="100" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <el-alert v-if="isSupplierRole" :title="t('system.roles.supplierFixed')" type="info" show-icon :closable="false" />

          <el-tabs v-else v-model="tab">
            <el-tab-pane :label="t('system.roles.tabs.functions')" name="functions">
              <div v-for="m in catalog?.modules ?? []" :key="m.key" class="perm-module">
                <el-checkbox
                  class="module-check"
                  :model-value="moduleState(m.key).all"
                  :indeterminate="moduleState(m.key).some"
                  :disabled="permsLocked"
                  @change="(v: string | number | boolean) => toggleModule(m.key, Boolean(v))"
                >
                  {{ pickLabel(m, locale) }}
                </el-checkbox>
                <el-checkbox-group v-model="form.permissions" :disabled="permsLocked" class="perm-items">
                  <el-checkbox v-for="p in m.permissions" :key="p.code" :value="p.code">
                    {{ pickLabel(p, locale) }}
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </el-tab-pane>
            <el-tab-pane :label="t('system.roles.tabs.data')" name="data">
              <el-radio-group v-model="form.dataScope" :disabled="permsLocked" class="scope-group">
                <el-radio v-for="s in dataScopes" :key="s" :value="s" class="scope-item">
                  <strong>{{ t(`enums.DataScope.${s}`) }}</strong>
                  <span class="desc">{{ t(`system.roles.dataScopeDesc.${s}`) }}</span>
                </el-radio>
              </el-radio-group>
            </el-tab-pane>
            <el-tab-pane :label="t('system.roles.tabs.fields')" name="fields">
              <p class="hint">{{ t('system.roles.fieldsHint') }}</p>
              <el-checkbox-group v-model="form.fieldPermissions" :disabled="permsLocked" class="field-group">
                <el-checkbox v-for="f in catalog?.fields ?? []" :key="f.code" :value="f.code" class="field-item">
                  <strong>{{ pickLabel(f, locale) }}</strong>
                  <span class="desc">{{ locale === 'en-US' ? f.descEn : f.descZh }}</span>
                </el-checkbox>
              </el-checkbox-group>
            </el-tab-pane>
          </el-tabs>

          <div v-if="canManage" class="footer">
            <el-button
              v-if="selected && !selected.isPreset && !creating"
              type="danger"
              plain
              icon="Delete"
              @click="remove"
            >
              {{ t('common.actions.delete') }}
            </el-button>
            <div class="spacer" />
            <el-button @click="cancel">{{ t('common.actions.cancel') }}</el-button>
            <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
          </div>
        </template>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.roles-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.role-list {
  flex: 0 0 280px;
}
.role-detail {
  flex: 1;
  min-width: 0;
}
.items {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.items li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.items li:hover {
  background: var(--el-fill-color-light);
}
.items li.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.items .name {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.items .count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.perm-module {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.module-check {
  flex: 0 0 150px;
  font-weight: 600;
}
.perm-items {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 4px 20px;
}
.scope-group,
.field-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.scope-item,
.field-item {
  height: auto;
}
.desc {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.footer {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.spacer {
  flex: 1;
}
</style>
