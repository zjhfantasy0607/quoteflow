<script setup lang="ts">
import type { NegotiationOfferParams, NegotiationThreadDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { inquiriesApi } from '@/api/inquiries';
import NegotiationProposalForm from '@/components/NegotiationProposalForm.vue';
import NegotiationTimeline from '@/components/NegotiationTimeline.vue';
import { confirmAction, promptText } from '@/utils/dialogs';

/**
 * 与一家入围供应商的议价（M11 §5，参考 PPT #30）：时间线 + 按 allowedActions 显示的操作（接受反提案、结束议价）+
 * 底部"发起下一轮议价"表单；轮到供应商时表单禁用并提示等待回复
 */
const props = defineProps<{ quoteId: string }>();
const emit = defineEmits<{ changed: [NegotiationThreadDto] }>();

const { t } = useI18n();
const thread = ref<NegotiationThreadDto | null>(null);
const loading = ref(false);
const acting = ref(false);

const can = (action: NegotiationThreadDto['allowedActions'][number]) =>
  thread.value?.allowedActions.includes(action) ?? false;
const last = computed(() => thread.value?.messages.at(-1) ?? null);
/** 顶部提示：已关闭 / 等供应商 / 收到反提案 / 已成交 / 只读 */
const banner = computed<{ type: 'info' | 'warning' | 'success'; text: string } | null>(() => {
  const th = thread.value;
  if (!th || th.messages.length === 0) return null;
  if (th.status === 'CLOSED') return { type: 'info', text: t('inquiries.negotiation.closed') };
  if (th.awaiting === 'SUPPLIER') return { type: 'info', text: t('inquiries.negotiation.waitingSupplier') };
  if (th.awaiting === 'BUYER' && last.value?.type === 'COUNTER')
    return { type: 'warning', text: t('inquiries.negotiation.counterReceived') };
  if (th.status === 'AGREED' && th.awaiting === 'BUYER')
    return { type: 'success', text: t('inquiries.negotiation.agreed') };
  if (th.awaiting === null) return { type: 'info', text: t('inquiries.negotiation.readonly') };
  return null;
});
/** 轮到采购方能出价时可填；等供应商回复时禁用（仍显示表单） */
const showForm = computed(() => can('offer') || thread.value?.awaiting === 'SUPPLIER');

async function load(): Promise<void> {
  loading.value = true;
  try {
    thread.value = await inquiriesApi.negotiation(props.quoteId);
  } finally {
    loading.value = false;
  }
}

async function run(
  action: () => Promise<NegotiationThreadDto>,
  success: (t: NegotiationThreadDto) => string,
) {
  acting.value = true;
  try {
    const updated = await action();
    thread.value = updated;
    ElMessage.success(success(updated));
    emit('changed', updated);
  } catch {
    // 错误提示由 http 拦截器显示；状态可能已变化，重新加载
    await load();
  } finally {
    acting.value = false;
  }
}

function offer(body: NegotiationOfferParams): void {
  void run(
    () => inquiriesApi.offer(props.quoteId, body),
    () => t('inquiries.negotiation.offered'),
  );
}

async function accept(): Promise<void> {
  if (!last.value || !(await confirmAction(t('inquiries.negotiation.acceptConfirm'), { type: 'info' })))
    return;
  const messageId = last.value.id;
  await run(
    () => inquiriesApi.acceptCounter(props.quoteId, messageId),
    (updated) => t('inquiries.negotiation.accepted', { no: updated.currentVersionNo }),
  );
}

async function close(): Promise<void> {
  const content = await promptText(
    t('inquiries.negotiation.closePrompt'),
    t('inquiries.negotiation.closeTitle'),
    {
      inputType: 'textarea',
      inputValidator: (v: string) => !v || v.length <= 1000,
      confirmButtonClass: 'el-button--danger',
    },
  );
  if (content === null) return;
  await run(
    () => inquiriesApi.closeNegotiation(props.quoteId, content.trim() || undefined),
    () => t('inquiries.negotiation.closedDone'),
  );
}

watch(() => props.quoteId, load, { immediate: true });
</script>

<template>
  <div v-loading="loading" class="negotiation-panel">
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
      <div v-if="can('accept') || can('close')" class="actions">
        <el-button
          v-if="can('close')"
          type="danger"
          plain
          icon="CircleClose"
          :loading="acting"
          @click="close"
        >
          {{ t('inquiries.negotiation.close') }}
        </el-button>
        <el-button v-if="can('accept')" type="success" icon="Select" :loading="acting" @click="accept">
          {{ t('inquiries.negotiation.accept') }}
        </el-button>
      </div>
      <el-card v-if="showForm" shadow="never" class="offer">
        <template #header>
          <span class="title">{{ t('inquiries.negotiation.offerTitle') }}</span>
        </template>
        <NegotiationProposalForm
          :thread="thread"
          mode="offer"
          :submitting="acting"
          :disabled="!can('offer')"
          @submit="offer"
        />
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.banner {
  margin-bottom: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 16px;
}
.offer {
  margin-top: 8px;
}
.title {
  font-weight: 600;
}
</style>
