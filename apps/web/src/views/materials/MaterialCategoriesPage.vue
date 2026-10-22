<script setup lang="ts">
import {
  PPL_MASTER_CODE,
  createCategorySchema,
  updateCategorySchema,
  type MaterialCategoryNodeDto,
  type PplVariantSummaryDto,
} from '@quoteflow/shared';
import { ElMessage, type TreeInstance } from 'element-plus';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { materialCategoriesApi } from '@/api/materials';
import { pplApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { useCategoryStore } from '@/stores/categories';
import { categoryMatches, categoryPath, effectivePplVariant } from '@/utils/categories';
import { confirmAction } from '@/utils/dialogs';
import { pickName } from '@/utils/format';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

/** R03-1：任意深度，界面上建议不超过 5 级 */
const SUGGESTED_MAX_DEPTH = 5;

const { t, locale } = useI18n();
const auth = useAuthStore();
const store = useCategoryStore();
const canManage = computed(() => auth.hasPerm('material:category:manage'));

const treeRef = ref<TreeInstance>();
const keyword = ref('');
const selectedId = ref<string | null>(null);
/** 正在新增时为上级 id（顶级为 null）；没在新增时为 undefined */
const creatingUnder = ref<string | null | undefined>(undefined);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive({ code: '', nameZh: '', nameEn: '', sort: 0, remark: '', pplVariantCode: '' });
/** 当前激活模板集的主模板与变体（下拉选项） */
const variants = ref<PplVariantSummaryDto[]>([]);

const creating = computed(() => creatingUnder.value !== undefined);
const selected = computed(() => (selectedId.value ? (store.byId.get(selectedId.value) ?? null) : null));
const showEditor = computed(() => creating.value || selected.value !== null);
const parentLabel = computed(() => {
  const parentId = creating.value ? creatingUnder.value : selected.value?.parentId;
  const path = categoryPath(store.byId, parentId);
  return path.length > 0 ? path.map((c) => pickName(c, locale.value)).join(' > ') : t('materials.categories.topLevel');
});
const variantName = (code: string) => {
  const v = variants.value.find((x) => x.code === code);
  return v ? t('materials.categories.pplVariantOption', { name: pickName(v, locale.value), code }) : code;
};
const variantOptions = computed(() => {
  const options = variants.value.map((v) => ({ value: v.code, label: variantName(v.code) }));
  // 绑定的变体不在激活版本里时也要能显示出来
  if (form.pplVariantCode && !options.some((o) => o.value === form.pplVariantCode)) {
    options.push({ value: form.pplVariantCode, label: form.pplVariantCode });
  }
  return options;
});
/** R05-6：按表单里的值（未保存也算）和上级的设置算出实际生效的变体 */
const effectiveVariant = computed(() =>
  effectivePplVariant(
    store.byId,
    creating.value ? creatingUnder.value : selected.value?.parentId,
    form.pplVariantCode || null,
  ),
);
const effectiveVariantText = computed(() => {
  const { code, from } = effectiveVariant.value;
  const text = t('materials.categories.pplEffective', { name: variantName(code ?? PPL_MASTER_CODE) });
  if (from) return text + t('materials.categories.pplInheritedFrom', { name: pickName(from, locale.value) });
  return code ? text : text + t('materials.categories.pplNotSet');
});
const variantMissing = computed(() => {
  const code = effectiveVariant.value.code;
  return code !== null && variants.value.length > 0 && !variants.value.some((v) => v.code === code);
});
const tooDeep = computed(
  () => creating.value && categoryPath(store.byId, creatingUnder.value).length + 1 > SUGGESTED_MAX_DEPTH,
);

function fill(node: MaterialCategoryNodeDto | null): void {
  errors.value = {};
  Object.assign(form, {
    code: node?.code ?? '',
    nameZh: node?.nameZh ?? '',
    nameEn: node?.nameEn ?? '',
    sort: node?.sort ?? 0,
    remark: node?.remark ?? '',
    pplVariantCode: node?.pplVariantCode ?? '',
  });
}

function select(node: MaterialCategoryNodeDto): void {
  creatingUnder.value = undefined;
  selectedId.value = node.id;
  fill(node);
}

function startCreate(parentId: string | null): void {
  const siblings = parentId ? (store.byId.get(parentId)?.children ?? []) : (store.tree ?? []);
  creatingUnder.value = parentId;
  fill(null);
  form.sort = siblings.reduce((max, c) => Math.max(max, c.sort), 0) + 1;
}

function cancel(): void {
  creatingUnder.value = undefined;
  fill(selected.value);
}

/** 重新加载整棵树（其他页面的分类下拉也会用到新数据），并选中 id */
async function reload(id: string | null): Promise<void> {
  await store.load(true);
  const node = (id ? store.byId.get(id) : undefined) ?? store.tree?.[0];
  if (node) select(node);
  else selectedId.value = null;
  await nextTick();
  treeRef.value?.setCurrentKey(selectedId.value ?? undefined);
  if (keyword.value) treeRef.value?.filter(keyword.value);
}

async function save(): Promise<void> {
  const base = {
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    sort: form.sort,
    remark: form.remark,
    pplVariantCode: form.pplVariantCode || null,
  };
  const data = creating.value ? { ...base, code: form.code, parentId: creatingUnder.value ?? null } : base;
  errors.value = zodErrors(creating.value ? createCategorySchema : updateCategorySchema, data);
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    const saved = creating.value
      ? await materialCategoriesApi.create(createCategorySchema.parse(data))
      : await materialCategoriesApi.update(selectedId.value!, updateCategorySchema.parse(data));
    ElMessage.success(t('common.saved'));
    creatingUnder.value = undefined;
    await reload(saved.id);
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'CATEGORY_CODE_TAKEN') errors.value = { code: translateError(body) };
    else if (body?.code === 'PPL_VARIANT_NOT_FOUND') errors.value = { pplVariantCode: translateError(body) };
    else if (body?.code === 'VALIDATION_FAILED') errors.value = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(): Promise<void> {
  const node = selected.value;
  if (!node) return;
  const disabling = node.status === 'ENABLED';
  const name = pickName(node, locale.value);
  const message = t(disabling ? 'materials.categories.disableConfirm' : 'materials.categories.enableConfirm', { name });
  if (!(await confirmAction(message, { type: disabling ? 'warning' : 'info' }))) return;
  try {
    await materialCategoriesApi.setStatus(node.id, disabling ? 'DISABLED' : 'ENABLED');
  } catch {
    return; // 错误提示由 http 拦截器显示
  }
  ElMessage.success(t('common.saved'));
  await reload(node.id);
}

/** 有下级或被引用时后端返回 CATEGORY_HAS_CHILDREN / CATEGORY_IN_USE，由 http 拦截器提示（R03-3） */
async function remove(): Promise<void> {
  const node = selected.value;
  if (!node) return;
  if (!(await confirmAction(t('materials.categories.deleteConfirm', { name: pickName(node, locale.value) })))) return;
  try {
    await materialCategoriesApi.remove(node.id);
  } catch {
    return;
  }
  ElMessage.success(t('materials.categories.deleted'));
  await reload(node.parentId);
}

function filterNode(value: string, data: Record<string, unknown>): boolean {
  return categoryMatches(value, data as unknown as MaterialCategoryNodeDto);
}

watch(keyword, (k) => treeRef.value?.filter(k));

async function loadVariants(): Promise<void> {
  try {
    variants.value = (await pplApi.activeVariants()).variants;
  } catch {
    variants.value = []; // 错误提示由 http 拦截器显示，下拉只剩已绑定的值
  }
}

onMounted(() => {
  void loadVariants();
  return reload(null);
});
</script>

<template>
  <div>
    <PageHeader :title="t('materials.categories.title')" :subtitle="t('materials.categories.subtitle')" />

    <div class="categories-layout">
      <el-card shadow="never" class="tree-card" body-style="padding: 12px">
        <el-input
          v-model="keyword"
          :placeholder="t('materials.categories.searchPlaceholder')"
          prefix-icon="Search"
          clearable
        />
        <el-tree
          ref="treeRef"
          class="tree"
          :data="store.tree ?? []"
          node-key="id"
          :props="{ label: 'code', children: 'children' }"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          :filter-node-method="filterNode"
          :empty-text="t('materials.categories.noData')"
          @node-click="select"
        >
          <template #default="{ data }">
            <span :class="['node', { off: !data.effectiveEnabled }]">
              <el-icon><Folder /></el-icon>
              <span class="name">{{ pickName(data, locale) }}</span>
              <span class="code">{{ data.code }}</span>
              <el-tag v-if="data.status === 'DISABLED'" size="small" type="info" disable-transitions>
                {{ t('materials.categories.disabledTag') }}
              </el-tag>
            </span>
          </template>
        </el-tree>
        <el-button v-if="canManage" class="create-top" type="primary" plain icon="Plus" @click="startCreate(null)">
          {{ t('materials.categories.createTop') }}
        </el-button>
      </el-card>

      <el-card shadow="never" class="editor-card">
        <el-empty v-if="!showEditor" :description="t('materials.categories.empty')" />
        <template v-else>
          <div class="editor-header">
            <h3 class="editor-title">
              {{ creating ? t('materials.categories.createTitle') : t('materials.categories.editTitle') }}
            </h3>
            <template v-if="!creating && selected">
              <StatusTag enum-name="EnableStatus" :value="selected.status" />
              <el-tag v-if="selected.isPreset" type="info" disable-transitions>{{ t('materials.categories.preset') }}</el-tag>
            </template>
          </div>

          <el-alert
            v-if="!canManage"
            :title="t('materials.categories.readonlyHint')"
            type="info"
            show-icon
            :closable="false"
            class="hint"
          />
          <template v-if="!creating && selected">
            <el-alert
              v-if="selected.status === 'DISABLED'"
              :title="t('materials.categories.disabledHint')"
              type="warning"
              show-icon
              :closable="false"
              class="hint"
            />
            <el-alert
              v-else-if="!selected.effectiveEnabled"
              :title="t('materials.categories.inheritedHint')"
              type="warning"
              show-icon
              :closable="false"
              class="hint"
            />
          </template>
          <el-alert
            v-if="tooDeep"
            :title="t('materials.categories.deepWarning')"
            type="warning"
            show-icon
            :closable="false"
            class="hint"
          />

          <el-form label-width="auto" :disabled="!canManage" class="editor-form" @submit.prevent="save">
            <el-form-item :label="t('materials.categories.fields.parent')">
              <el-input :model-value="parentLabel" disabled />
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.nameZh')" :error="errors.nameZh" required>
              <el-input v-model="form.nameZh" maxlength="100" show-word-limit />
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.nameEn')" :error="errors.nameEn" required>
              <el-input v-model="form.nameEn" maxlength="100" show-word-limit />
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.code')" :error="errors.code" required>
              <el-input
                v-model="form.code"
                :disabled="!creating"
                maxlength="30"
                :placeholder="t('materials.categories.codeRule')"
                @blur="form.code = form.code.trim().toUpperCase()"
              />
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.sort')" :error="errors.sort">
              <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.pplVariant')" :error="errors.pplVariantCode">
              <el-select
                v-model="form.pplVariantCode"
                class="variant-select"
                clearable
                :placeholder="t('materials.categories.pplInherit')"
              >
                <el-option v-for="o in variantOptions" :key="o.value" :value="o.value" :label="o.label" />
              </el-select>
              <div class="variant-effective">{{ effectiveVariantText }}</div>
              <div v-if="variantMissing" class="variant-missing">
                {{ t('materials.categories.pplVariantMissing', { code: effectiveVariant.code }) }}
              </div>
              <div class="variant-hint">{{ t('materials.categories.pplMasterHint') }}</div>
            </el-form-item>
            <el-form-item :label="t('materials.categories.fields.remark')" :error="errors.remark">
              <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="1000" show-word-limit />
            </el-form-item>
          </el-form>

          <p v-if="!creating && selected" class="meta">
            {{ t('materials.categories.materialCount', { count: selected.materialCount }) }}
          </p>

          <div v-if="canManage" class="footer">
            <el-button type="primary" :loading="saving" @click="save">{{ t('common.actions.save') }}</el-button>
            <el-button @click="cancel">{{ t('common.actions.cancel') }}</el-button>
            <div class="spacer" />
            <template v-if="!creating && selected">
              <el-button :type="selected.status === 'ENABLED' ? 'warning' : 'success'" plain @click="toggleStatus">
                {{ selected.status === 'ENABLED' ? t('materials.categories.disable') : t('materials.categories.enable') }}
              </el-button>
              <el-tooltip :content="t('materials.categories.deleteHint')" placement="top">
                <el-button type="danger" plain icon="Delete" @click="remove">{{ t('common.actions.delete') }}</el-button>
              </el-tooltip>
              <el-button
                type="primary"
                plain
                icon="Plus"
                :disabled="!selected.effectiveEnabled"
                @click="startCreate(selected.id)"
              >
                {{ t('materials.categories.createChild') }}
              </el-button>
            </template>
          </div>
        </template>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.categories-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.tree-card {
  flex: 0 0 340px;
}
.editor-card {
  flex: 1;
  min-width: 0;
}
.tree {
  max-height: calc(100vh - 300px);
  margin: 12px 0;
  overflow-y: auto;
}
.node {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}
.node.off .name,
.node.off .el-icon {
  color: var(--el-text-color-placeholder);
}
.node .code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.create-top {
  width: 100%;
}
.editor-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
}
.editor-title {
  margin: 0 8px 0 0;
  font-size: 16px;
}
.hint {
  margin-bottom: 12px;
}
.editor-form {
  max-width: 640px;
}
.variant-select {
  width: 100%;
}
.variant-effective,
.variant-missing,
.variant-hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
}
.variant-effective {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
.variant-missing {
  color: var(--el-color-danger);
}
.variant-hint {
  color: var(--el-text-color-secondary);
}
.meta {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.footer {
  display: flex;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.spacer {
  flex: 1;
}
</style>
