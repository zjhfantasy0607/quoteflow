import { Dec, decimalPlaces, isDecimalString, roundTo } from '../decimal';
import { PPL_QUANTITY_KEY, PPL_TEXT_MAX_LENGTH, type PplColumn, type PplResolvedColumn } from './definition';
import { applyFormulas } from './formulas';

/** 报价取值的编码（04 §5）与校验（04 §8.2）。 */

export type PplValue = string | number | boolean | string[];
export type PplValues = Record<string, PplValue>;
/** 字典类型 → 启用项编码 */
export type PplDictLookup = Readonly<Record<string, readonly string[]>>;

export interface PplLineRef {
  id: string;
  lineNo: number;
  /** 询价行数量（规范十进制字符串） */
  quantity: string | null;
}

export type PplValueErrorCode =
  | 'required'
  | 'too_long'
  | 'invalid_text'
  | 'invalid_integer'
  | 'invalid_number'
  | 'too_many_decimals'
  | 'too_small'
  | 'too_large'
  | 'invalid_date'
  | 'invalid_bool'
  | 'invalid_option';

export interface PplValueError {
  lineId: string;
  lineNo: number;
  key: string;
  code: PplValueErrorCode;
  params?: Record<string, string | number>;
  message: string;
}

type Normalized =
  | { ok: true; value: PplValue | null }
  | { ok: false; code: PplValueErrorCode; params?: Record<string, string | number> };

const INT_RE = /^-?\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isEmpty(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (typeof raw === 'string' && raw.trim() === '') ||
    (Array.isArray(raw) && raw.length === 0)
  );
}

function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function checkRange(column: PplColumn, value: Dec | number): Normalized | null {
  const min = column.min ?? (column.type === 'percent' ? 0 : undefined);
  const max = column.max ?? (column.type === 'percent' ? 100 : undefined);
  const v = new Dec(value);
  if (min !== undefined && v.lessThan(min)) return { ok: false, code: 'too_small', params: { min } };
  if (max !== undefined && v.greaterThan(max)) return { ok: false, code: 'too_large', params: { max } };
  return null;
}

/**
 * 按列类型校验并规范化一个取值；空值返回 value: null（不判断必填）。
 * dict 为 null 时不校验字典编码（如校验定义里的 default）。
 */
export function normalizePplValue(column: PplColumn, raw: unknown, dict: PplDictLookup | null): Normalized {
  if (isEmpty(raw)) return { ok: true, value: null };
  switch (column.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { ok: false, code: 'invalid_text' };
      const value = raw.trim();
      const max = column.maxLength ?? PPL_TEXT_MAX_LENGTH[column.type];
      return value.length > max ? { ok: false, code: 'too_long', params: { max } } : { ok: true, value };
    }
    case 'int': {
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      const value = Number(text);
      if (!INT_RE.test(text) || !Number.isSafeInteger(value)) return { ok: false, code: 'invalid_integer' };
      return checkRange(column, value) ?? { ok: true, value };
    }
    case 'decimal':
    case 'money':
    case 'percent': {
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (!isDecimalString(text)) return { ok: false, code: 'invalid_number' };
      const precision = column.precision ?? 0;
      if (decimalPlaces(text) > precision)
        return { ok: false, code: 'too_many_decimals', params: { max: precision } };
      return checkRange(column, new Dec(text)) ?? { ok: true, value: roundTo(text, precision) };
    }
    case 'date': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      return isValidDate(text) ? { ok: true, value: text } : { ok: false, code: 'invalid_date' };
    }
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, code: 'invalid_bool' };
    case 'enum': {
      if (typeof raw !== 'string') return { ok: false, code: 'invalid_option' };
      const value = raw.trim();
      if (dict && !(dict[column.dictType ?? ''] ?? []).includes(value)) {
        return { ok: false, code: 'invalid_option', params: { value } };
      }
      return { ok: true, value };
    }
    case 'multiEnum': {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        return { ok: false, code: 'invalid_option' };
      }
      const value = [...new Set((raw as string[]).map((item) => item.trim()).filter(Boolean))];
      const options = dict?.[column.dictType ?? ''] ?? [];
      const unknown = dict ? value.find((item) => !options.includes(item)) : undefined;
      if (unknown !== undefined) return { ok: false, code: 'invalid_option', params: { value: unknown } };
      return { ok: true, value: value.length ? value : null };
    }
  }
}

const MESSAGES: Record<PplValueErrorCode, (p: Record<string, string | number>) => string> = {
  required: () => 'is required',
  too_long: (p) => `must be at most ${p.max} characters`,
  invalid_text: () => 'must be text',
  invalid_integer: () => 'must be an integer',
  invalid_number: () => 'must be a number',
  too_many_decimals: (p) => `allows at most ${p.max} decimal places`,
  too_small: (p) => `must be at least ${p.min}`,
  too_large: (p) => `must be at most ${p.max}`,
  invalid_date: () => 'must be a date (YYYY-MM-DD)',
  invalid_bool: () => 'must be yes or no',
  invalid_option: (p) => (p.value ? `has an unknown option "${p.value}"` : 'has an invalid option'),
};

export interface ValidateQuoteValuesOptions {
  /** draft 只校验格式；submit 还校验必填 */
  mode: 'draft' | 'submit';
  /** 议价版本允许在取值里写 quantity（05 §5） */
  allowQuantity?: boolean;
}

export interface ValidateQuoteValuesResult {
  /** 规范化后的取值（丢弃未知 key、预填列、公式列后重算公式），按 lineId */
  values: Record<string, PplValues>;
  errors: PplValueError[];
}

/** 04 §8.2：逐行逐个供应商列校验；不在 lines 里的行被丢弃。 */
export function validateQuoteValues(
  columns: readonly PplResolvedColumn[],
  lines: readonly PplLineRef[],
  values: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>,
  dict: PplDictLookup,
  options: ValidateQuoteValuesOptions,
): ValidateQuoteValuesResult {
  const editable = columns.filter(
    (c) => c.source === 'supplier' || (options.allowQuantity && c.key === PPL_QUANTITY_KEY),
  );
  const result: Record<string, PplValues> = {};
  const errors: PplValueError[] = [];
  for (const line of lines) {
    const input = values[line.id] ?? {};
    const row: PplValues = {};
    for (const column of editable) {
      const normalized = normalizePplValue(column, input[column.key], dict);
      let code: PplValueErrorCode | null = null;
      let params: Record<string, string | number> = {};
      if (!normalized.ok) {
        code = normalized.code;
        params = normalized.params ?? {};
      } else if (normalized.value !== null) {
        row[column.key] = normalized.value;
      } else if (options.mode === 'submit' && column.required) {
        code = 'required';
      }
      if (code) {
        errors.push({
          lineId: line.id,
          lineNo: line.lineNo,
          key: column.key,
          code,
          ...(Object.keys(params).length ? { params } : {}),
          message: `Line ${line.lineNo} "${column.labelEn}" ${MESSAGES[code](params)}`,
        });
      }
    }
    result[line.id] = applyFormulas(columns, row, { quantity: line.quantity });
  }
  return { values: result, errors };
}

/** 新建草稿时一行的默认值：供应商列上合法的 default。 */
export function buildDraftDefaults(columns: readonly PplColumn[]): PplValues {
  const values: PplValues = {};
  for (const column of columns) {
    if (column.source !== 'supplier' || column.default === undefined) continue;
    const normalized = normalizePplValue(column, column.default, null);
    if (normalized.ok && normalized.value !== null) values[column.key] = normalized.value;
  }
  return values;
}
