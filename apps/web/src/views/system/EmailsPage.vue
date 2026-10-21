<script setup lang="ts">
import { EmailStatus, EmailType, type EmailDetailDto, type EmailListItemDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { emailsApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { confirmAction } from '@/utils/dialogs';
import { formatDateTime } from '@/utils/format';

const LANGUAGES = ['zh-CN', 'en-US', 'bilingual'] as const;

const { t } = useI18n();

const query = reactive({
  range: null as [string, string] | null,
  type: '',
  status: '',
  language: '',
  keyword: '',
  page: 1,
  pageSize: 20,
});
const rows = ref<EmailListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);
const detail = ref<EmailDetailDto | null>(null);
const drawer = ref(false);
const resending = ref(false);

/** 语言值 zh-CN / en-US / bilingual 对应文案键 zhCN / enUS / bilingual */
const languageLabel = (lang: string) => t(`system.emails.languages.${lang.replace('-', '')}`);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await emailsApi.list({
      type: (query.type || undefined) as EmailListItemDto['type'] | undefined,
      status: (query.status || undefined) as EmailListItemDto['status'] | undefined,
      language: (query.language || undefined) as (typeof LANGUAGES)[number] | undefined,
      keyword: query.keyword || undefined,
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
  Object.assign(query, { range: null, type: '', status: '', language: '', keyword: '', page: 1 });
  void load();
}

async function open(row: EmailListItemDto): Promise<void> {
  detail.value = await emailsApi.detail(row.id);
  drawer.value = true;
}

async function resend(): Promise<void> {
  if (!detail.value || !(await confirmAction(t('system.emails.resendConfirm'), { type: 'info' }))) return;
  resending.value = true;
  try {
    await emailsApi.resend(detail.value.id);
    ElMessage.success(t('system.emails.resent'));
    detail.value = await emailsApi.detail(detail.value.id);
    await load();
  } finally {
    resending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('system.emails.title')" :subtitle="t('system.emails.subtitle')" />

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
        <el-form-item>
          <el-select v-model="query.type" :placeholder="t('system.emails.allTypes')" clearable style="width: 160px">
            <el-option v-for="v in Object.values(EmailType)" :key="v" :value="v" :label="t(`enums.EmailType.${v}`)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.status" :placeholder="t('system.emails.allStatus')" clearable style="width: 130px">
            <el-option v-for="v in Object.values(EmailStatus)" :key="v" :value="v" :label="t(`enums.EmailStatus.${v}`)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.language" :placeholder="t('system.emails.allLanguages')" clearable style="width: 130px">
            <el-option v-for="v in LANGUAGES" :key="v" :value="v" :label="languageLabel(v)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="query.keyword" :placeholder="t('system.emails.keywordPlaceholder')" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" icon="Search">{{ t('common.actions.search') }}</el-button>
          <el-button icon="Refresh" @click="resetQuery">{{ t('common.actions.reset') }}</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="rows" :empty-text="t('common.table.empty')" @row-click="open">
        <el-table-column :label="t('system.emails.fields.createdAt')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.emails.fields.type')" width="140">
          <template #default="{ row }">{{ t(`enums.EmailType.${row.type}`) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.emails.fields.to')" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.toAddresses.join(', ') }}</template>
        </el-table-column>
        <el-table-column prop="subject" :label="t('system.emails.fields.subject')" min-width="240" show-overflow-tooltip />
        <el-table-column :label="t('system.emails.fields.language')" width="100">
          <template #default="{ row }">{{ languageLabel(row.language) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.emails.fields.sentAt')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.sentAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('system.emails.fields.status')" width="110">
          <template #default="{ row }"><StatusTag enum-name="EmailStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column prop="attempts" :label="t('system.emails.fields.attempts')" width="100" />
        <el-table-column :label="t('common.table.actions')" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="open(row)">{{ t('common.actions.view') }}</el-button>
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

    <el-drawer v-model="drawer" :title="t('system.emails.detailTitle')" size="55%">
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="t('system.emails.fields.subject')" :span="2">{{ detail.subject }}</el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.to')" :span="2">
            {{ detail.toAddresses.join(', ') }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.ccAddresses.length > 0" :label="t('system.emails.fields.cc')" :span="2">
            {{ detail.ccAddresses.join(', ') }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.type')">{{ t(`enums.EmailType.${detail.type}`) }}</el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.language')">{{ languageLabel(detail.language) }}</el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.status')">
            <StatusTag enum-name="EmailStatus" :value="detail.status" />
          </el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.attempts')">{{ detail.attempts }}</el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.createdAt')">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item :label="t('system.emails.fields.sentAt')">{{ formatDateTime(detail.sentAt) }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.lastError" :label="t('system.emails.fields.lastError')" :span="2">
            <span class="error-text">{{ detail.lastError }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div class="body-title">{{ t('system.emails.body') }}</div>
        <!-- 正文来自系统模板，仍用 sandbox 隔离，不执行脚本、不能访问本页 -->
        <iframe :srcdoc="detail.html" sandbox="" :title="detail.subject" class="mail-body" />
      </template>
      <template #footer>
        <el-button
          v-if="detail && detail.status !== 'PENDING'"
          type="primary"
          icon="RefreshRight"
          :loading="resending"
          @click="resend"
        >
          {{ t('system.emails.resend') }}
        </el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
:deep(.el-table__row) {
  cursor: pointer;
}
.body-title {
  margin: 16px 0 8px;
  font-weight: 600;
}
.mail-body {
  width: 100%;
  height: 520px;
  border: 1px solid var(--el-border-color);
  background: #fff;
}
.error-text {
  color: var(--el-color-danger);
  word-break: break-all;
}
</style>
