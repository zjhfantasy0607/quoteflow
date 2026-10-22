import type { Locale } from '../enums';
import type { PplColumn, PplPrefillSource } from './definition';
import type { PplValues } from './values';

/** 预填列的数据来源（04 §4）：询价行，币种来自询价单 */
export interface PplPrefillLine {
  lineNo: number;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  categoryNameZh: string | null;
  categoryNameEn: string | null;
  spec: string | null;
  unitNameZh: string | null;
  unitNameEn: string | null;
  /** 规范十进制字符串 */
  quantity: string | null;
  drawingRef: string | null;
  currency: string | null;
}

/** name、categoryName、unitName 按语言取，英文为空回退中文 */
function pick(zh: string | null, en: string | null, locale: Locale): string | null {
  return locale === 'en-US' ? en || zh : zh;
}

export function pplPrefillValue(
  source: PplPrefillSource,
  line: PplPrefillLine,
  locale: Locale,
): string | number | null {
  switch (source) {
    case 'lineNo':
      return line.lineNo;
    case 'materialCode':
      return line.materialCode;
    case 'name':
      return pick(line.nameZh, line.nameEn, locale);
    case 'categoryName':
      return pick(line.categoryNameZh, line.categoryNameEn, locale);
    case 'spec':
      return line.spec;
    case 'unitName':
      return pick(line.unitNameZh, line.unitNameEn, locale);
    case 'quantity':
      return line.quantity;
    case 'drawingRef':
      return line.drawingRef;
    case 'currency':
      return line.currency;
  }
}

/** 一行全部预填列的取值，空值不写入 */
export function buildPrefillValues(
  columns: readonly PplColumn[],
  line: PplPrefillLine,
  locale: Locale,
): PplValues {
  const values: PplValues = {};
  for (const column of columns) {
    if (column.source !== 'prefill' || !column.prefillFrom) continue;
    const value = pplPrefillValue(column.prefillFrom, line, locale);
    if (value !== null && value !== '') values[column.key] = value;
  }
  return values;
}
