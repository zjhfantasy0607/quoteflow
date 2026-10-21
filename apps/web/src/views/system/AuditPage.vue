<script setup lang="ts">
import type { AuditLogDto, UserDto } from '@quoteflow/shared';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { auditApi, usersApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime } from '@/utils/format';

/** 目前会写操作日志的对象类型；未翻译的类型和动作直接显示代码 */
const ENTITY_TYPES = ['user', 'role', 'dictType', 'dictItem', 'systemParam', 'email'];

const { t, te } = useI18n();
const auth = useAuthStore();

const query = reactive({
  range: null as [string, string] | null,
  actorId: '',
  action: '',
  entityType: '',
  entityId: '',
  page: 1,
  pageSize: 20,
});
const rows = ref<AuditLogDto[]>([]);
const total = ref(0);
const loading = ref(false);
const users = ref<UserDto[]>([]);

function actionLabel(action: string): string {
  const key = `system.audit.actions.${action.replace(/\./g, '_')}`;
  return te(key) ? t(key) : action;
}

function entityLabel(type: string): string {
  const key = `system.audit.entityTypes.${type}`;
  return te(key) ? t(key) : type;
}

function actorLabel(row: AuditLogDto): string {
  return row.actor ? `${row.actor.name} (${row.actor.username})` : t('system.audit.systemActor');
}

function detailText(detail: unknown): string {
  return detail === null || detail === undefined ? '' : JSON.stringify(detail, null, 2);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await auditApi.list({
      actorId: query.actorId || undefined,
      action: query.action || undefined,
      entityType: query.entityType || undefined,
      entityId: query.entityId || undefined,
      from: query.range?.[0],
      to: query.range?.[1],
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
  Object.assign(query, { range: null, actorId: '', action: '', entityType: '', entityId: '', page: 1 });
  void load();
}

onMounted(async () => {
  if (auth.hasPerm('system:user:view')) {
    users.value = (await usersApi.list({ page: 1, pageSize: 100 }).catch(() => null))?.items ?? [];
  }
  await load();
});
</script>

<template>
  <div>
    <PageHeader :title="t('system.audit.title')" :subtitle="t('system.audit.subtitle')" />

    <el-card shadow="never" class="qf-card">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-date-picker
            v-model="query.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            :start-placeholder="t('system.emails.startDate')"
            :end-placeholder="t('system.emails.endDate')"
            :range-separator="t('system.emails.rangeSeparator')"
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item v-if="users.length > 0">
          <el-select v-model="query.actorId" :placeholder="t('system.audit.allActors')" clearable filterable style="width: 180px">
            <el-option v-for="u in users" :key="u.id" :value="u.id" :label="`${u.name} (${u.username})`" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="query.action" :placeholder="t('system.audit.actionPlaceholder')" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.entityType" :placeholder="t('system.audit.allEntityTypes')" clearable style="width: 150px">
            <el-option v-for="v in ENTITY_TYPES" :key="v" :value="v" :label="entityLabel(v)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="query.entityId" :placeholder="t('system.audit.entityIdPlaceholder')" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{ t('common.actions.search') }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" row-key="id" :empty-text="t('common.table.empty')">
        <el-table-column type="expand" width="40">
          <template #default="{ row }">
            <div class="detail">
              <div class="detail-title">{{ t('system.audit.fields.detail') }}</div>
              <pre v-if="detailText(row.detail)">{{ detailText(row.detail) }}</pre>
              <span v-else class="muted">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.audit.fields.createdAt')" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt, { seconds: true }) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.audit.fields.actor')" min-width="160">
          <template #default="{ row }">{{ actorLabel(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.audit.fields.action')" min-width="150">
          <template #default="{ row }">
            <span :title="row.action">{{ actionLabel(row.action) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('system.audit.fields.entity')" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            {{ entityLabel(row.entityType) }}<span v-if="row.entityId" class="muted"> {{ row.entityId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="summary" :label="t('system.audit.fields.summary')" min-width="220" show-overflow-tooltip />
        <el-table-column prop="ip" :label="t('system.audit.fields.ip')" width="130" />
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
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.detail {
  padding: 8px 48px;
}
.detail-title {
  margin-bottom: 4px;
  font-weight: 600;
}
.detail pre {
  max-height: 320px;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
  font-size: 12px;
}
.muted {
  color: var(--el-text-color-secondary);
}
</style>
