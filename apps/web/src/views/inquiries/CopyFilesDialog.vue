<script setup lang="ts">
import type { InquiryFileKind, InquiryLineDto, InquiryRoundDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import { pickName } from '@/utils/format';

/** 复制到其他行（R06-5）：目标行新增指向同一文件的挂载，已有的跳过 */
const props = defineProps<{
  inquiryId: string;
  roundNo: number;
  lines: InquiryLineDto[];
  from: InquiryLineDto | null;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ copied: [InquiryRoundDto] }>();

const { t, locale } = useI18n();
const kind = ref<'ALL' | InquiryFileKind>('ALL');
const targets = ref<string[]>([]);
const saving = ref(false);

const others = computed(() => props.lines.filter((l) => l.id !== props.from?.id));
const allChecked = computed({
  get: () => others.value.length > 0 && targets.value.length === others.value.length,
  set: (v: boolean) => {
    targets.value = v ? others.value.map((l) => l.id) : [];
  },
});
const hasFiles = computed(() =>
  (props.from?.files ?? []).some((f) => kind.value === 'ALL' || f.kind === kind.value),
);

watch(visible, (open) => {
  if (!open) return;
  kind.value = 'ALL';
  targets.value = [];
});

async function submit(): Promise<void> {
  if (!props.from) return;
  if (!hasFiles.value) {
    ElMessage.warning(t('inquiries.files.copyNothing'));
    return;
  }
  if (targets.value.length === 0) {
    ElMessage.warning(t('inquiries.files.copyNoTarget'));
    return;
  }
  saving.value = true;
  try {
    const round = await inquiriesApi.copyFiles(props.inquiryId, props.roundNo, {
      fromLineId: props.from.id,
      toLineIds: targets.value,
      ...(kind.value === 'ALL' ? {} : { kind: kind.value }),
    });
    ElMessage.success(t('inquiries.files.copied'));
    emit('copied', round);
    visible.value = false;
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'FILE_LIMIT_EXCEEDED' && body.params?.lineNo) {
      ElMessage.error(t('inquiries.files.copyLimit', body.params));
    } else {
      ElMessage.error(translateError(body));
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="from ? t('inquiries.files.copyTitle', { no: from.lineNo }) : ''"
    width="560px"
    append-to-body
  >
    <el-form label-position="top">
      <el-form-item :label="t('inquiries.files.copyKind')">
        <el-radio-group v-model="kind">
          <el-radio value="ALL">{{ t('inquiries.files.copyAll') }}</el-radio>
          <el-radio value="SPEC_DOC">{{ t('inquiries.files.copySpecOnly') }}</el-radio>
          <el-radio value="PRODUCT_IMAGE">{{ t('inquiries.files.copyImagesOnly') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('inquiries.files.copyTargets')">
        <div class="targets">
          <el-checkbox v-model="allChecked">{{ t('inquiries.files.copySelectAll') }}</el-checkbox>
          <el-checkbox-group v-model="targets" class="target-list">
            <el-checkbox v-for="l in others" :key="l.id" :value="l.id">
              #{{ l.lineNo }} {{ pickName(l, locale) }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="hint">{{ t('inquiries.files.copyHint') }}</div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{
        t('common.actions.confirm')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.targets {
  width: 100%;
}
.target-list {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow-y: auto;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
