import { Dec, parseDecimal, roundTo } from '../decimal';
import { PPL_QUANTITY_KEY, PPL_TOTAL_KEY, type PplColumn } from './definition';
import type { PplValues } from './values';

/** 公式（04 §6）：前端预览与后端保存共用；输入不全返回 null。 */

export function exclTax(unitPriceInclTax: unknown, taxRate: unknown, dp = 4): string | null {
  const price = parseDecimal(unitPriceInclTax);
  const rate = parseDecimal(taxRate);
  if (!price || !rate) return null;
  const divisor = rate.div(100).plus(1);
  return divisor.isZero() ? null : roundTo(price.div(divisor), dp);
}

export function lineTotal(unitPriceInclTax: unknown, quantity: unknown, dp = 2): string | null {
  const price = parseDecimal(unitPriceInclTax);
  const qty = parseDecimal(quantity);
  return price && qty ? roundTo(price.times(qty), dp) : null;
}

export function cbm(lengthCm: unknown, widthCm: unknown, heightCm: unknown, dp = 4): string | null {
  const l = parseDecimal(lengthCm);
  const w = parseDecimal(widthCm);
  const h = parseDecimal(heightCm);
  return l && w && h ? roundTo(l.times(w).times(h).div(1_000_000), dp) : null;
}

export interface PplFormulaContext {
  /** 询价行数量；取值里有 quantity（议价改过数量）时优先用取值里的 */
  quantity: string | null;
}

interface PplFormula {
  /** 公式依赖的列 key，定义校验时检查它们存在、变体不能排除 */
  inputs: readonly string[];
  compute(values: PplValues, ctx: PplFormulaContext, dp: number): string | null;
}

export const PPL_FORMULAS = {
  exclTax: {
    inputs: ['unit_price_incl_tax', 'tax_rate'],
    compute: (v, _ctx, dp) => exclTax(v.unit_price_incl_tax, v.tax_rate, dp),
  },
  lineTotal: {
    inputs: ['unit_price_incl_tax', PPL_QUANTITY_KEY],
    compute: (v, ctx, dp) => lineTotal(v.unit_price_incl_tax, v[PPL_QUANTITY_KEY] ?? ctx.quantity, dp),
  },
  cbm: {
    inputs: ['carton_l_cm', 'carton_w_cm', 'carton_h_cm'],
    compute: (v, _ctx, dp) => cbm(v.carton_l_cm, v.carton_w_cm, v.carton_h_cm, dp),
  },
} satisfies Record<string, PplFormula>;

export type PplFormulaName = keyof typeof PPL_FORMULAS;

export function isPplFormulaName(name: string): name is PplFormulaName {
  return Object.hasOwn(PPL_FORMULAS, name);
}

/** 按列定义重算全部公式列（忽略传入的公式列值），返回新对象。 */
export function applyFormulas(
  columns: readonly PplColumn[],
  values: PplValues,
  ctx: PplFormulaContext,
): PplValues {
  const result: PplValues = { ...values };
  for (const column of columns) {
    if (column.source !== 'formula') continue;
    delete result[column.key];
    if (!column.formula || !isPplFormulaName(column.formula)) continue;
    const value = PPL_FORMULAS[column.formula].compute(values, ctx, column.precision ?? 4);
    if (value !== null) result[column.key] = value;
  }
  return result;
}

/** 报价版本合计：Σ 各行含税总价，2 位小数。 */
export function quoteTotal(rows: readonly PplValues[]): string {
  let sum = new Dec(0);
  for (const row of rows) {
    const total = parseDecimal(row[PPL_TOTAL_KEY]);
    if (total) sum = sum.plus(total);
  }
  return roundTo(sum, 2);
}
