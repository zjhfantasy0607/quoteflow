import {
  applyFormulas,
  buildDraftDefaults,
  buildPrefillValues,
  decimalPlaces,
  isDecimalString,
  quoteTotal,
  roundTo,
  validateQuoteValues,
  type DictItemDto,
  type Locale,
  type PortalLineDto,
  type PplColumn,
  type PplDictLookup,
  type PplResolvedColumn,
  type PplValueError,
  type PplValues,
} from '@quoteflow/shared';
import { i18n } from '@/i18n';
import { pickLabel } from './format';

/** 报价表的一行：询价行 id、行号、数量（公式用）和预填列的值（名称类按当前语言，04 §4） */
export interface PplSheetLine {
  id: string;
  lineNo: number;
  quantity: string;
  prefill: PplValues;
}

/** 表单里一行的原始取值（输入框里的字符串、开关的布尔值等），由后端按列定义规范化 */
export type PplRawValues = Record<string, unknown>;

/** 校验错误按行、列 key 分组 */
export type PplErrorMap = Record<string, Record<string, PplValueError>>;

/** 门户询价行 → 报价表行；单位名称取字典（找不到时显示编码），币种取询价单 */
export function portalSheetLines(
  lines: readonly PortalLineDto[],
  columns: readonly PplColumn[],
  currency: string,
  locale: Locale,
  unitOf: (code: string) => Pick<DictItemDto, 'nameZh' | 'nameEn'> | undefined,
): PplSheetLine[] {
  return lines.map((l) => {
    const unit = unitOf(l.unitCode);
    return {
      id: l.id,
      lineNo: l.lineNo,
      quantity: l.quantity,
      prefill: buildPrefillValues(
        columns,
        {
          lineNo: l.lineNo,
          materialCode: l.materialCode,
          nameZh: l.nameZh,
          nameEn: l.nameEn,
          categoryNameZh: l.category.nameZh,
          categoryNameEn: l.category.nameEn,
          spec: l.spec,
          unitNameZh: unit?.nameZh ?? l.unitCode,
          unitNameEn: unit?.nameEn ?? null,
          quantity: l.quantity,
          drawingRef: l.drawingRef,
          currency,
        },
        locale,
      ),
    };
  });
}

/** 编辑中的一行：供应商填写的值 + 实时计算的公式列（与后端同一份公式，04 §6）+ 预填列 */
export function liveRow(
  columns: readonly PplColumn[],
  line: PplSheetLine,
  raw: PplRawValues | undefined,
): PplValues {
  return {
    ...applyFormulas(columns, (raw ?? {}) as PplValues, { quantity: line.quantity }),
    ...line.prefill,
  };
}

/** 合计（含税）：各行含税总价之和，2 位小数 */
export function sheetTotal(
  columns: readonly PplColumn[],
  lines: readonly PplSheetLine[],
  values: Record<string, PplRawValues>,
): string {
  return quoteTotal(
    lines.map((l) => applyFormulas(columns, (values[l.id] ?? {}) as PplValues, { quantity: l.quantity })),
  );
}

/** 新草稿：每行用列的 default 初始化（税率 13，R09-3） */
export function defaultValues(
  columns: readonly PplColumn[],
  lines: readonly PplSheetLine[],
): Record<string, PplRawValues> {
  return Object.fromEntries(lines.map((l) => [l.id, buildDraftDefaults(columns)]));
}

/** 只保留供应商填写列（以版本取值为底继续填时，公式列由后端重算） */
export function supplierValues(columns: readonly PplColumn[], values: PplRawValues): PplRawValues {
  const keys = new Set(columns.filter((c) => c.source === 'supplier').map((c) => c.key));
  return Object.fromEntries(Object.entries(values).filter(([key, v]) => keys.has(key) && v !== null));
}

/** 字典 → 取值校验用的编码表 */
export function dictLookup(
  columns: readonly PplColumn[],
  items: (type: string) => readonly DictItemDto[],
): PplDictLookup {
  const types = [...new Set(columns.filter((c) => c.dictType).map((c) => c.dictType!))];
  return Object.fromEntries(types.map((type) => [type, items(type).map((i) => i.code)]));
}

/** R09-11：提交前做与后端相同的校验（草稿只校验格式），错误按行号、列顺序 */
export function validateSheet(
  columns: readonly PplResolvedColumn[],
  lines: readonly PplSheetLine[],
  values: Record<string, PplRawValues>,
  dict: PplDictLookup,
  mode: 'draft' | 'submit',
): PplValueError[] {
  return validateQuoteValues(
    columns,
    lines.map((l) => ({ id: l.id, lineNo: l.lineNo, quantity: l.quantity })),
    values,
    dict,
    { mode },
  ).errors;
}

export function errorMap(errors: readonly PplValueError[]): PplErrorMap {
  const map: PplErrorMap = {};
  for (const e of errors) (map[e.lineId] ??= {})[e.key] = e;
  return map;
}

/** 错误文案沿用 Excel 行错误的翻译（excel.rowErrors.<code>，与锁定 Excel 导入同一组 code） */
export function pplErrorText(e: Pick<PplValueError, 'code' | 'params'>): string {
  const { t, te } = i18n.global;
  const key = `excel.rowErrors.${e.code}`;
  return te(key) ? t(key, e.params ?? {}) : e.code;
}

/** 列标签按当前语言 */
export function columnLabel(column: Pick<PplColumn, 'labelZh' | 'labelEn'>, locale: string): string {
  return pickLabel(column, locale);
}

/** 必填列里已经填了几个（列表里提示填写进度） */
export function requiredProgress(
  columns: readonly PplResolvedColumn[],
  raw: PplRawValues | undefined,
): { filled: number; total: number } {
  const required = columns.filter((c) => c.required && c.source === 'supplier');
  const isFilled = (v: unknown) =>
    v !== undefined &&
    v !== null &&
    !(typeof v === 'string' && v.trim() === '') &&
    !(Array.isArray(v) && v.length === 0);
  return { filled: required.filter((c) => isFilled(raw?.[c.key])).length, total: required.length };
}

/**
 * 小数类输入框失焦时的格式化（04 §5）：合法且位数没超时补足到 precision 位（"1.5" → "1.5000"），
 * 位数超了不偷偷四舍五入，原样留着由校验提示
 */
export function formatDecimalInput(column: Pick<PplColumn, 'precision'>, value: string): string {
  const text = value.trim();
  if (!isDecimalString(text)) return text;
  const precision = column.precision ?? 0;
  return decimalPlaces(text) <= precision ? roundTo(text, precision) : text;
}

/** int 输入框失焦时：整数字符串转成数字，其他原样留着由校验提示 */
export function formatIntInput(value: string): string | number {
  const text = value.trim();
  const n = Number(text);
  return /^-?\d+$/.test(text) && Number.isSafeInteger(n) ? n : text;
}
