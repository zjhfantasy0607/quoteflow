import { Decimal } from 'decimal.js';

/** 金额、数量一律用它计算：ROUND_HALF_UP，40 位有效数字。 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** 规范的十进制字符串：不接受科学计数法、前导 +、千分位、空白。 */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

export function decimalPlaces(value: string): number {
  const dot = value.indexOf('.');
  return dot < 0 ? 0 : value.length - dot - 1;
}

/** 规范的十进制字符串转 Dec，其他输入返回 null。 */
export function parseDecimal(value: unknown): Dec | null {
  return typeof value === 'string' && isDecimalString(value) ? new Dec(value) : null;
}

/** 四舍五入（ROUND_HALF_UP）到 dp 位，输出定长字符串；不会输出 "-0.00"。 */
export function roundTo(value: Decimal.Value, dp: number): string {
  const rounded = new Dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  return (rounded.isZero() ? new Dec(0) : rounded).toFixed(dp);
}
