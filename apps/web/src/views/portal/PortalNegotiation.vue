<script setup lang="ts">
import {
  NEGOTIATION_ATTACHMENTS_MAX,
  NEGOTIATION_CONTENT_MAX,
  type FileDto,
  type NegotiationOfferParams,
  type NegotiationRespondParams,
  type NegotiationThreadDto,
  type PortalQuoteDetailDto,
} from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { portalApi } from '@/api/portal';
import FileUploader from '@/components/FileUploader.vue';
import NegotiationProposalForm from '@/components/NegotiationProposalForm.vue';
import NegotiationTimeline from '@/components/NegotiationTimeline.vue';
import StatusTag from '@/components/StatusTag.vue';
import { confirmAction } from '@/utils/dialogs';

/**
 * 门户报价详情的"议价"区（M11 §5，参考 PPT #30）：采购方发过议价才出现。时间线（供应商看到自己议价的全部内容）；
 * 轮到供应商时显示"接受 / 拒绝 / 反提案"，拒绝和反提案必须填原因。接受成交后报价生成新版本，通知页面刷新详情
 */
const props = defineProps<{ detail: PortalQuoteDetailDto }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const thread = ref<NegotiationThreadDto | null>(null);
const loading = ref(false);
const acting = ref(false);
/** 正在填写的回复 */
const replying = ref<'reject' | 'counter' | null>(null);
const reason = ref('');
const files = ref<FileDto[]>([]);

const can = (action: NegotiationThreadDto['allowedActions'][number]) =>
  thread.value?.allowedActions.includes(action) ?? false;
const last = computed(() => thread.value?.messages.at(-1) ?? null);
const banner = computed<{ type: 'info' | 'warning' | 'success'; text: string } | null>(() => {
  const th = thread.value;
  if (!th) return null;
  if (th.status === 'CLOSED') return { type: 'info', text: t('portal.negotiation.closed') };
  if (th.awaiting === 'SUPPLIER') return { type: 'warning', text: t('portal.negotiation.yourTurn') };
  if (th.status === 'AGREED') return { type: 'success', text: t('portal.negotiation.agreed') };
  if (th.awaiting === 'BUYER') return { type: 'info', text: t('portal.negotiation.waitingBuyer') };
  return null;
});

async function load(): Promise<void> {
  if (props.detail.negotiationStatus === null) {
    thread.value = null;
    return;
  }
  loading.value = true;
  try {
    thread.value = await portalApi.negotiation(props.detail.id);
  } finally {
    loading.value = false;
  }
}

function startReply(mode: 'reject' | 'counter'): void {
  replying.value = mode;
  reason.value = '';
  files.value = [];
}

async function respond(
  body: Omit<NegotiationRespondParams, 'replyToId'>,
  success: (t: NegotiationThreadDto) => string,
) {
  if (!last.value) return;
  acting.value = true;
  try {
    const updated = await portalApi.respondNegotiation(props.detail.id, {
      ...body,
      replyToId: last.value.id,
    });
    thread.value = updated;
    replying.value = null;
    ElMessage.success(success(updated));
    emit('changed');
  } catch {
    // 错误提示由 http 拦截器显示；采购方可能已经关闭了议价，重新加载
    await load();
  } finally {
    acting.value = false;
  }
}

async function accept(): Promise<void> {
  if (!(await confirmAction(t('portal.negotiation.acceptConfirm'), { type: 'info' }))) return;
  await respond({ type: 'ACCEPT' }, (updated) =>
    t('portal.negotiation.accepted', { no: updated.currentVersionNo }),
  );
}

async function reject(): Promise<void> {
  if (!reason.value.trim()) {
    ElMessage.warning(t('negotiation.form.reasonRequired'));
    return;
  }
  await respond(
    { type: 'REJECT', content: reason.value.trim(), attachmentFileIds: files.value.map((f) => f.id) },
    () => t('portal.negotiation.sent'),
  );
}

async function counter(body: NegotiationOfferParams): Promise<void> {
  await respond({ ...body, type: 'COUNTER' }, () => t('portal.negotiation.sent'));
}

watch(() => [props.detail.id, props.detail.negotiationStatus, props.detail.currentVersion?.versionNo], load, {
  immediate: true,
});
</script>

<template>
  <el-card v-if="detail.negotiationStatus !== null" v-loading="loading" shadow="never" class="qf-card">
    <template #header>
      <span class="section-title">{{ t('portal.negotiation.title') }}</span>
      <StatusTag v-if="thread?.status" enum-name="NegotiationStatus" :value="thread.status" class="status" />
    </template>
    <template v-if="thread">
      <el-alert
        v-if="banner"
        :type="banner.type"
        :title="banner.text"
        show-icon
        :closable="false"
        class="banner"
      />
      <NegotiationTimeline :thread="thread" />

      <div v-if="thread.allowedActions.length > 0 && replying === null" class="actions">
        <el-button v-if="can('reject')" type="danger" plain :disabled="acting" @click="startReply('reject')">
          {{ t('portal.negotiation.reject') }}
        </el-button>
        <el-button
          v-if="can('counter')"
          type="warning"
          plain
          :disabled="acting"
          @click="startReply('counter')"
        >
          {{ t('portal.negotiation.counter') }}
        </el-button>
        <el-button v-if="can('accept')" type="success" icon="Select" :loading="acting" @click="accept">
          {{ t('portal.negotiation.accept') }}
        </el-button>
      </div>

      <el-card v-if="replying === 'reject'" shadow="never" class="reply">
        <template #header>
          <span class="section-title">{{ t('portal.negotiation.rejectTitle') }}</span>
        </template>
        <el-form label-position="top" @submit.prevent>
          <el-form-item :label="t('negotiation.fields.reason')" required>
            <el-input
              v-model="reason"
              type="textarea"
              :rows="3"
              :maxlength="NEGOTIATION_CONTENT_MAX"
              show-word-limit
              :placeholder="t('negotiation.form.reasonPlaceholder')"
              class="reason-input"
            />
          </el-form-item>
          <el-form-item :label="t('negotiation.fields.attachments')">
            <FileUploader v-model="files" kind="ATTACHMENT" :limit="NEGOTIATION_ATTACHMENTS_MAX" />
          </el-form-item>
        </el-form>
        <div class="actions">
          <el-button @click="replying = null">{{ t('portal.negotiation.cancel') }}</el-button>
          <el-button type="danger" :loading="acting" @click="reject">{{
            t('portal.negotiation.reject')
          }}</el-button>
        </div>
      </el-card>

      <el-card v-if="replying === 'counter'" shadow="never" class="reply">
        <template #header>
          <span class="section-title">{{ t('portal.negotiation.counterTitle') }}</span>
        </template>
        <NegotiationProposalForm :thread="thread" mode="counter" :submitting="acting" @submit="counter">
          <template #actions>
            <el-button @click="replying = null">{{ t('portal.negotiation.cancel') }}</el-button>
          </template>
        </NegotiationProposalForm>
      </el-card>
    </template>
  </el-card>
</template>

<style scoped>
.section-title {
  font-weight: 600;
}
.status {
  margin-left: 8px;
}
.banner {
  margin-bottom: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.reply {
  margin-top: 12px;
}
</style>
