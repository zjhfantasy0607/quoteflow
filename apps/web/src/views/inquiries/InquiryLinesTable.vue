<script setup lang="ts">
import { updateLineSchema, type InquiryLineDto, type UpdateLineParams } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { inquiriesApi } from '@/api/inquiries';
import CategoryTreeSelect from '@/components/CategoryTreeSelect.vue';
import DictSelect from '@/components/DictSelect.vue';
import DictTag from '@/components/DictTag.vue';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

/**
 * 询价行表格（R06-2、R06-3）。editable 时可以行内编辑（一次一行）、删除、拖动行首图标调整顺序；
 * 材料行的名称、规格、单位、分类取自材料库，只能改数量、品牌、图纸编号和备注
 */
const props = defineProps<{
  inquiryId: string;
  roundNo: number;
  lines: InquiryLineDto[];
  editable: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();

const { t, locale } = useI18n();

/** 后端错误码 → 行内字段 */
const FIELD_OF_ERROR: Record<string, string> = {
  DICT_ITEM_INVALID: 'unitCode',
  CATEGORY_DISABLED: 'categoryId',
};

const emptyForm = () => ({
  materialCode: '',
  nameZh: '',
  nameEn: '',
  spec: '',
  unitCode: null as string | null,
  categoryId: null as string | null,
  quantity: '',
  brand: '',
  drawingRef: '',
  remark: '',
});
const editingId = ref<string | null>(null);
const form = reactive(emptyForm());
const errors = ref<FieldErrors>({});
const saving = ref(false);

const isEditing = (line: InquiryLineDto) => editingId.value === line.id;
const isManualEditing = (line: InquiryLineDto) => isEditing(line) && line.materialId === null;

function startEdit(line: InquiryLineDto): void {
  if (editingId.value && editingId.value !== line.id) {
    ElMessage.warning(t('inquiries.lines.finishEditing'));
    return;
  }
  editingId.value = line.id;
  errors.value = {};
  Object.assign(form, {
    materialCode: line.materialCode ?? '',
    nameZh: line.nameZh,
    nameEn: line.nameEn ?? '',
    spec: line.spec,
    unitCode: line.unitCode,
    categoryId: line.category.id,
    quantity: line.quantity,
    brand: line.brand ?? '',
    drawingRef: line.drawingRef ?? '',
    remark: line.remark ?? '',
  });
}

function cancelEdit(): void {
  editingId.value = null;
  errors.value = {};
}

function payload(line: InquiryLineDto): UpdateLineParams {
  const common = {
    quantity: form.quantity,
    brand: form.brand,
    drawingRef: form.drawingRef,
    remark: form.remark,
  };
  if (line.materialId) return { source: 'MATERIAL', ...common };
  return {
    source: 'MANUAL',
    materialCode: form.materialCode,
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    spec: form.spec,
    unitCode: form.unitCode ?? '',
    categoryId: form.categoryId ?? '',
    ...common,
  };
}

async function saveEdit(line: InquiryLineDto): Promise<void> {
  const data = payload(line);
  errors.value = zodErrors(updateLineSchema, data);
  if (Object.keys(errors.value).length > 0) return;
  saving.value = true;
  try {
    await inquiriesApi.updateLine(props.inquiryId, props.roundNo, line.id, updateLineSchema.parse(data));
    ElMessage.success(t('common.saved'));
    editingId.value = null;
    emit('changed');
  } catch (err) {
    const body = apiError(err);
    const field = body?.code ? FIELD_OF_ERROR[body.code] : undefined;
    if (field) errors.value = { [field]: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}

async function remove(line: InquiryLineDto): Promise<void> {
  const message = t('inquiries.lines.deleteConfirm', { no: line.lineNo, name: pickName(line, locale.value) });
  if (!(await confirmAction(message))) return;
  try {
    await inquiriesApi.removeLine(props.inquiryId, props.roundNo, line.id);
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('inquiries.lines.deleted'));
  emit('changed');
}

// ---------- 拖动排序（R06-3）：拖行首的图标，放到目标行上 ----------

const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

/** 事件目标所在的数据行序号（与 lines 的下标一致） */
function rowIndexOf(target: EventTarget | null): number {
  const tr = (target as HTMLElement | null)?.closest?.('tr.el-table__row');
  if (!tr?.parentElement) return -1;
  return Array.from(tr.parentElement.querySelectorAll(':scope > tr.el-table__row')).indexOf(tr);
}

function onDragStart(index: number, e: DragEvent): void {
  dragFrom.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
}

function onDragOver(e: DragEvent): void {
  if (dragFrom.value === null) return;
  e.preventDefault();
  dragOver.value = rowIndexOf(e.target);
}

function onDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}

async function onDrop(e: DragEvent): Promise<void> {
  if (dragFrom.value === null) return;
  e.preventDefault();
  const from = dragFrom.value;
  const to = rowIndexOf(e.target);
  onDragEnd();
  if (to < 0 || to === from) return;
  const ids = props.lines.map((l) => l.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  try {
    await inquiriesApi.reorderLines(props.inquiryId, props.roundNo, ids);
  } catch {
    return;
  }
  ElMessage.success(t('inquiries.lines.reordered'));
  emit('changed');
}

function rowClassName({ rowIndex }: { rowIndex: number }): string {
  return dragFrom.value !== null && rowIndex === dragOver.value && rowIndex !== dragFrom.value
    ? 'drag-over'
    : '';
}
</script>

<template>
  <div class="lines-table" @dragover="onDragOver" @drop="onDrop">
    <el-table
      :data="lines"
      row-key="id"
      :empty-text="t('inquiries.lines.empty')"
      :row-class-name="rowClassName"
    >
      <el-table-column v-if="editable" width="40" class-name="handle-col">
        <template #default="{ $index }">
          <span
            class="drag-handle"
            :class="{ disabled: editingId !== null }"
            :draggable="editingId === null"
            :title="t('inquiries.lines.dragHandle')"
            :aria-label="t('inquiries.lines.dragHandle')"
            @dragstart="onDragStart($index, $event)"
            @dragend="onDragEnd"
          >
            <el-icon><Rank /></el-icon>
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="lineNo" :label="t('inquiries.lines.fields.lineNo')" width="64" />
      <el-table-column :label="t('inquiries.lines.fields.materialCode')" min-width="130">
        <template #default="{ row }">
          <template v-if="isManualEditing(row)">
            <el-input v-model="form.materialCode" size="small" maxlength="50" />
          </template>
          <template v-else>
            <span>{{ row.materialCode }}</span>
            <el-tag v-if="row.materialId" size="small" type="success" class="source-tag" disable-transitions>
              {{ t('inquiries.lines.fromMaterial') }}
            </el-tag>
          </template>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.name')" min-width="170">
        <template #default="{ row }">
          <template v-if="isManualEditing(row)">
            <el-input
              v-model="form.nameZh"
              size="small"
              maxlength="100"
              :placeholder="t('inquiries.lines.fields.nameZh')"
            />
            <div v-if="errors.nameZh" class="err">{{ errors.nameZh }}</div>
            <el-input
              v-model="form.nameEn"
              size="small"
              maxlength="100"
              class="mt"
              :placeholder="t('inquiries.lines.fields.nameEn')"
            />
          </template>
          <template v-else>
            <div>{{ row.nameZh }}</div>
            <div v-if="row.nameEn" class="sub">{{ row.nameEn }}</div>
          </template>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.spec')" min-width="200">
        <template #default="{ row }">
          <template v-if="isManualEditing(row)">
            <el-input v-model="form.spec" size="small" maxlength="200" />
            <div v-if="errors.spec" class="err">{{ errors.spec }}</div>
          </template>
          <span v-else>{{ row.spec }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.unit')" min-width="100">
        <template #default="{ row }">
          <template v-if="isManualEditing(row)">
            <DictSelect v-model="form.unitCode" type="unit" :clearable="false" />
            <div v-if="errors.unitCode" class="err">{{ errors.unitCode }}</div>
          </template>
          <DictTag v-else type="unit" :code="row.unitCode" plain />
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.quantity')" min-width="130" align="right">
        <template #default="{ row }">
          <template v-if="isEditing(row)">
            <el-input
              v-model="form.quantity"
              size="small"
              maxlength="20"
              :placeholder="t('inquiries.lines.quantityHint')"
            />
            <div v-if="errors.quantity" class="err">{{ errors.quantity }}</div>
          </template>
          <span v-else>{{ row.quantity }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.category')" min-width="150">
        <template #default="{ row }">
          <template v-if="isManualEditing(row)">
            <CategoryTreeSelect v-model="form.categoryId" :clearable="false" />
            <div v-if="errors.categoryId" class="err">{{ errors.categoryId }}</div>
          </template>
          <template v-else>
            <el-tooltip
              v-if="!row.category.effectiveEnabled"
              :content="t('materials.list.categoryOff')"
              placement="top"
            >
              <el-icon class="category-off-icon"><WarningFilled /></el-icon>
            </el-tooltip>
            <span :class="{ 'category-off': !row.category.effectiveEnabled }">{{
              pickName(row.category, locale)
            }}</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.brand')" min-width="110">
        <template #default="{ row }">
          <el-input v-if="isEditing(row)" v-model="form.brand" size="small" maxlength="100" />
          <span v-else>{{ row.brand }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.drawingRef')" min-width="130">
        <template #default="{ row }">
          <el-input v-if="isEditing(row)" v-model="form.drawingRef" size="small" maxlength="100" />
          <span v-else>{{ row.drawingRef }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('inquiries.lines.fields.remark')" min-width="150">
        <template #default="{ row }">
          <el-input v-if="isEditing(row)" v-model="form.remark" size="small" maxlength="1000" />
          <span v-else>{{ row.remark }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="editable" :label="t('common.table.actions')" width="130" fixed="right">
        <template #default="{ row }">
          <template v-if="isEditing(row)">
            <el-button link type="primary" :loading="saving" @click="saveEdit(row)">
              {{ t('common.actions.save') }}
            </el-button>
            <el-button link @click="cancelEdit">{{ t('common.actions.cancel') }}</el-button>
            <el-tooltip v-if="row.materialId" :content="t('inquiries.lines.materialLocked')" placement="top">
              <el-icon class="lock-icon"><Lock /></el-icon>
            </el-tooltip>
          </template>
          <template v-else>
            <el-button link type="primary" @click="startEdit(row)">{{ t('common.actions.edit') }}</el-button>
            <el-button link type="danger" @click="remove(row)">{{ t('common.actions.delete') }}</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="editable && lines.length > 1" class="hint">{{ t('inquiries.lines.dragHint') }}</div>
  </div>
</template>

<style scoped>
.drag-handle {
  display: inline-flex;
  color: var(--el-text-color-secondary);
  cursor: grab;
}
.drag-handle.disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.lines-table :deep(.drag-over > td) {
  background: var(--el-color-primary-light-9) !important;
  box-shadow: inset 0 2px 0 var(--el-color-primary);
}
.source-tag {
  margin-left: 6px;
}
.sub,
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.hint {
  margin-top: 6px;
}
.err {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}
.mt {
  margin-top: 4px;
}
.category-off {
  color: var(--el-text-color-placeholder);
}
.category-off-icon {
  margin-right: 4px;
  color: var(--el-color-warning);
  vertical-align: -2px;
}
.lock-icon {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  vertical-align: -2px;
}
</style>
