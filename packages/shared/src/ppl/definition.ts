import { z } from 'zod';

/** PPL 模板定义（04 §3、§4）。zod 只管结构，跨字段规则在 validateDefinition()。 */

export const PPL_COLUMN_TYPES = [
  'text',
  'textarea',
  'int',
  'decimal',
  'money',
  'percent',
  'date',
  'bool',
  'enum',
  'multiEnum',
] as const;
export type PplColumnType = (typeof PPL_COLUMN_TYPES)[number];

export const PPL_SOURCES = ['prefill', 'supplier', 'formula'] as const;
export type PplSource = (typeof PPL_SOURCES)[number];

export const PPL_PREFILL_SOURCES = [
  'lineNo',
  'materialCode',
  'name',
  'categoryName',
  'spec',
  'unitName',
  'quantity',
  'drawingRef',
  'currency',
] as const;
export type PplPrefillSource = (typeof PPL_PREFILL_SOURCES)[number];

export const PPL_DECIMAL_TYPES: readonly PplColumnType[] = ['decimal', 'money', 'percent'];
export const PPL_ENUM_TYPES: readonly PplColumnType[] = ['enum', 'multiEnum'];
/** text / textarea 未设 maxLength 时的默认长度 */
export const PPL_TEXT_MAX_LENGTH = { text: 200, textarea: 1000 } as const;

export const PPL_MASTER_CODE = 'PPL-MASTER';
export const PPL_VARIANT_CODE_RE = /^PPL-[A-Z0-9-]+$/;
export const PPL_COLUMN_KEY_RE = /^[a-z][a-z0-9_]*$/;
/** 主模板必须有且必填的列，系统靠它们算合计（04 §8.1） */
export const PPL_CORE_KEYS = ['unit_price_incl_tax', 'tax_rate'] as const;
/** 议价成交时报价取值里唯一允许出现的预填列 key（04 §6） */
export const PPL_QUANTITY_KEY = 'quantity';
export const PPL_TOTAL_KEY = 'total_price_incl_tax';

const label = z.string().min(1).max(100);

export const pplColumnSchema = z.strictObject({
  key: z.string().regex(PPL_COLUMN_KEY_RE),
  group: z.string().min(1),
  labelZh: label,
  labelEn: label,
  type: z.enum(PPL_COLUMN_TYPES),
  source: z.enum(PPL_SOURCES),
  required: z.boolean().optional(),
  precision: z.int().min(0).max(8).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.int().min(1).max(5000).optional(),
  dictType: z.string().min(1).optional(),
  formula: z.string().min(1).optional(),
  prefillFrom: z.enum(PPL_PREFILL_SOURCES).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  sensitive: z.boolean().optional(),
  inMatrix: z.boolean().optional(),
  keyField: z.boolean().optional(),
  logistics: z.boolean().optional(),
  width: z.int().min(40).max(800).optional(),
});

export const pplDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  label: label,
  groups: z
    .array(z.strictObject({ key: z.string().regex(PPL_COLUMN_KEY_RE), labelZh: label, labelEn: label }))
    .min(1),
  master: z.strictObject({
    code: z.literal(PPL_MASTER_CODE),
    nameZh: label,
    nameEn: label,
    columns: z.array(pplColumnSchema).min(1).max(300),
  }),
  variants: z
    .array(
      z.strictObject({
        code: z.string().regex(PPL_VARIANT_CODE_RE),
        nameZh: label,
        nameEn: label,
        exclude: z.array(z.string()),
        required: z.array(z.string()),
      }),
    )
    .max(50),
});

export type PplDefinition = z.infer<typeof pplDefinitionSchema>;
export type PplColumn = PplDefinition['master']['columns'][number];
export type PplVariant = PplDefinition['variants'][number];
export type PplGroup = PplDefinition['groups'][number];

/** 某个变体实际使用的列：保持主模板顺序，required 已合并为 boolean */
export interface PplResolvedColumn extends PplColumn {
  required: boolean;
}
