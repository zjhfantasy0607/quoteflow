import { SYSTEM_PARAMS, type SystemParamKey } from '@quoteflow/shared';
import { z } from 'zod';

/** 系统参数页的表单字段，由 shared 里各参数的 zod schema 推出（新增参数不用改前端表单） */
export type ParamField =
  | { kind: 'number'; field: string | null; min?: number; max?: number; integer: boolean }
  | { kind: 'boolean'; field: string | null }
  | { kind: 'text'; field: string | null; maxLength?: number }
  | { kind: 'stringList'; field: string | null };

function describe(schema: z.ZodType, field: string | null): ParamField {
  if (schema instanceof z.ZodNumber) {
    return {
      kind: 'number',
      field,
      min: Number.isFinite(schema.minValue) ? (schema.minValue ?? undefined) : undefined,
      max: Number.isFinite(schema.maxValue) ? (schema.maxValue ?? undefined) : undefined,
      integer: schema.isInt,
    };
  }
  if (schema instanceof z.ZodBoolean) return { kind: 'boolean', field };
  if (schema instanceof z.ZodString) return { kind: 'text', field, maxLength: schema.maxLength ?? undefined };
  if (schema instanceof z.ZodArray && schema.element instanceof z.ZodString) return { kind: 'stringList', field };
  throw new Error(`Unsupported param schema for ${field ?? 'value'}`);
}

/** 参数 key 里的点会被 vue-i18n 当成路径分隔符，文案键里换成下划线：company.profile → company_profile */
export function paramI18nKey(key: string): string {
  return key.replace(/\./g, '_');
}

/** 对象参数按字段展开（field 为字段名）；标量参数只有一个字段（field 为 null） */
export function describeParam(key: SystemParamKey): ParamField[] {
  const schema = SYSTEM_PARAMS[key].schema as z.ZodType;
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodType>).map(([field, s]) => describe(s, field));
  }
  return [describe(schema, null)];
}
