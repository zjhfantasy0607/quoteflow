<script setup lang="ts">
import { isSystemParamKey, SYSTEM_PARAMS, type RoleDto, type SystemParamDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiError, translateError } from '@/api/http';
import { paramsApi, rolesApi } from '@/api/system';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, pickName } from '@/utils/format';
import { describeParam, paramI18nKey, type ParamField } from '@/utils/params';
import { serverFieldErrors, zodErrors, type FieldErrors } from '@/utils/validate';

const { t, te, locale } = useI18n();
const auth = useAuthStore();

/** 每个参数一份表单：对象参数按字段存，标量参数存在 value 字段里 */
type ParamForm = Record<string, unknown>;

const params = ref<SystemParamDto[]>([]);
const forms = reactive<Record<string, ParamForm>>({});
const errors = reactive<Record<string, FieldErrors>>({});
const saving = reactive<Record<string, boolean>>({});
const roles = ref<RoleDto[]>([]);
const internalRoles = computed(() => roles.value.filter((r) => !r.forSupplier));

const fieldKey = (f: ParamField) => f.field ?? 'value';
const ik = paramI18nKey;

function fieldsOf(key: string): ParamField[] {
  return isSystemParamKey(key) ? describeParam(key) : [];
}

function isObjectParam(key: string): boolean {
  return fieldsOf(key).some((f) => f.field !== null);
}

function toForm(key: string, value: unknown): ParamForm {
  // 参数值都是 JSON；从响应式数组里取出的是 Proxy，structuredClone 会报 DataCloneError
  const copy: unknown = JSON.parse(JSON.stringify(value));
  return isObjectParam(key) ? (copy as ParamForm) : { value: copy };
}

function fromForm(key: string): unknown {
  return isObjectParam(key) ? { ...forms[key] } : forms[key].value;
}

function setField(key: string, f: ParamField, value: unknown): void {
  forms[key][fieldKey(f)] = value;
}

const numberOf = (key: string, f: ParamField) => forms[key]?.[fieldKey(f)] as number | undefined;
const boolOf = (key: string, f: ParamField) => Boolean(forms[key]?.[fieldKey(f)]);
const textOf = (key: string, f: ParamField) => String(forms[key]?.[fieldKey(f)] ?? '');
const listOf = (key: string, f: ParamField) => (forms[key]?.[fieldKey(f)] as string[] | undefined) ?? [];

function fieldLabel(key: string, f: ParamField): string {
  return f.field ? t(`system.params.fields.${ik(key)}.${f.field}`) : '';
}

function unitOf(key: string): string {
  const k = `system.params.units.${ik(key)}`;
  return te(k) ? t(k) : '';
}

function roleName(code: string): string {
  const role = roles.value.find((r) => r.code === code);
  return role ? pickName(role, locale.value) : code;
}

/** 默认值的可读形式 */
function formatValue(key: string, value: unknown): string {
  const show = (f: ParamField, v: unknown): string => {
    if (f.kind === 'boolean') return v ? t('system.params.yes') : t('system.params.no');
    if (f.kind === 'stringList') {
      const list = (v as string[]) ?? [];
      return list.length > 0 ? list.map(roleName).join(', ') : t('system.params.none');
    }
    return v === '' || v === null || v === undefined ? t('system.params.none') : String(v);
  };
  const fields = fieldsOf(key);
  if (!isObjectParam(key)) return `${show(fields[0], value)} ${unitOf(key)}`.trim();
  const obj = (value ?? {}) as Record<string, unknown>;
  return fields.map((f) => `${fieldLabel(key, f)} ${show(f, obj[f.field!])}`).join(' / ');
}

function restore(p: SystemParamDto): void {
  forms[p.key] = toForm(p.key, p.defaultValue);
  errors[p.key] = {};
  ElMessage.info(t('system.params.restored'));
}

async function save(p: SystemParamDto): Promise<void> {
  if (!isSystemParamKey(p.key)) return;
  const value = fromForm(p.key);
  const fieldErrors = zodErrors(SYSTEM_PARAMS[p.key].schema, value);
  // 标量参数的错误路径是空串，挂到 value 字段上
  errors[p.key] = Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k || 'value', v]));
  if (Object.keys(fieldErrors).length > 0) return;

  saving[p.key] = true;
  try {
    const saved = await paramsApi.update(p.key, value);
    params.value = params.value.map((x) => (x.key === saved.key ? saved : x));
    forms[p.key] = toForm(p.key, saved.value);
    ElMessage.success(t('common.saved'));
  } catch (err) {
    const body = apiError(err);
    if (body?.code === 'VALIDATION_FAILED') errors[p.key] = serverFieldErrors(body.details);
    else ElMessage.error(translateError(body));
  } finally {
    saving[p.key] = false;
  }
}

onMounted(async () => {
  if (auth.hasPerm('system:role:view')) roles.value = await rolesApi.list().catch(() => []);
  params.value = await paramsApi.list();
  for (const p of params.value) {
    forms[p.key] = toForm(p.key, p.value);
    errors[p.key] = {};
  }
});
</script>

<template>
  <div>
    <PageHeader :title="t('system.params.title')" :subtitle="t('system.params.subtitle')" />

    <el-card v-for="p in params" :key="p.key" shadow="never" class="qf-card param-card">
      <template #header>
        <div class="card-header">
          <div>
            <div class="param-title">
              {{ t(`system.params.titles.${ik(p.key)}`) }}
              <span class="param-key">{{ p.key }}</span>
            </div>
            <div class="param-desc">{{ locale === 'zh-CN' ? p.descZh : p.descEn }}</div>
          </div>
          <div class="updated">
            {{ p.updatedAt ? t('system.params.updatedAt', { time: formatDateTime(p.updatedAt) }) : t('system.params.neverUpdated') }}
          </div>
        </div>
      </template>

      <el-form v-if="forms[p.key]" label-width="auto" class="param-form" @submit.prevent="save(p)">
        <el-form-item
          v-for="f in fieldsOf(p.key)"
          :key="fieldKey(f)"
          :label="fieldLabel(p.key, f)"
          :error="errors[p.key]?.[fieldKey(f)]"
        >
          <template v-if="f.kind === 'number'">
            <el-input-number
              :model-value="numberOf(p.key, f)"
              :min="f.min"
              :max="f.max"
              :precision="f.integer ? 0 : undefined"
              controls-position="right"
              @update:model-value="(v: unknown) => setField(p.key, f, v)"
            />
            <span v-if="!f.field && unitOf(p.key)" class="unit">{{ unitOf(p.key) }}</span>
          </template>
          <el-switch
            v-else-if="f.kind === 'boolean'"
            :model-value="boolOf(p.key, f)"
            :active-text="t('system.params.yes')"
            :inactive-text="t('system.params.no')"
            @update:model-value="(v: unknown) => setField(p.key, f, v)"
          />
          <el-input
            v-else-if="f.kind === 'text'"
            :model-value="textOf(p.key, f)"
            :maxlength="f.maxLength"
            class="text-input"
            @update:model-value="(v: unknown) => setField(p.key, f, v)"
          />
          <el-select
            v-else
            :model-value="listOf(p.key, f)"
            multiple
            filterable
            :allow-create="internalRoles.length === 0"
            :placeholder="t('system.params.sealRolesPlaceholder')"
            class="list-input"
            @update:model-value="(v: unknown) => setField(p.key, f, v)"
          >
            <el-option v-for="r in internalRoles" :key="r.code" :value="r.code" :label="pickName(r, locale)" />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="card-footer">
        <div class="default">
          <span class="default-label">{{ t('system.params.defaultValue') }}</span>
          <span>{{ formatValue(p.key, p.defaultValue) }}</span>
        </div>
        <div class="buttons">
          <el-button @click="restore(p)">{{ t('system.params.restoreDefault') }}</el-button>
          <el-button type="primary" :loading="saving[p.key]" @click="save(p)">{{ t('common.actions.save') }}</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.param-title {
  font-weight: 600;
}
.param-key {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
  font-size: 12px;
}
.param-desc {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.updated {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.param-form {
  max-width: 720px;
}
.unit {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}
.text-input,
.list-input {
  width: 420px;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.default {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.default-label {
  margin-right: 8px;
  font-weight: 600;
}
.buttons {
  display: flex;
  gap: 8px;
}
</style>
