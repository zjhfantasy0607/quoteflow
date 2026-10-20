import { APP_TZ } from '@quoteflow/shared';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

type DateInput = string | Date | null | undefined;

/** 按 UTC+8 显示日期时间，如 2026-11-20 17:00 */
export function formatDateTime(value: DateInput, options: { seconds?: boolean } = {}): string {
  if (!value) return '';
  return dayjs(value)
    .tz(APP_TZ)
    .format(options.seconds ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
}

export function formatDate(value: DateInput): string {
  if (!value) return '';
  return dayjs(value).tz(APP_TZ).format('YYYY-MM-DD');
}

/**
 * 金额千分位。只做字符串处理，不经过浮点数（金额在接口里一律是字符串）。
 * formatMoney('12800.5', 2) → '12,800.50'
 */
export function formatMoney(value: string | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || value === '') return '';
  const negative = value.startsWith('-');
  const [intRaw, fracRaw = ''] = (negative ? value.slice(1) : value).split('.');
  const intPart = (intRaw.replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fracRaw;
  if (decimals !== undefined) frac = frac.padEnd(decimals, '0').slice(0, decimals);
  return `${negative ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
}

/** 双语标签（权限树、敏感字段、PPL 列等用 labelZh / labelEn） */
export function pickLabel(item: { labelZh: string; labelEn?: string | null } | null | undefined, locale: string): string {
  if (!item) return '';
  return locale === 'en-US' && item.labelEn ? item.labelEn : item.labelZh;
}

/** 双语名称：英文界面且有英文名时显示英文，否则显示中文 */
export function pickName(
  item: { nameZh: string; nameEn?: string | null } | null | undefined,
  locale: string,
): string {
  if (!item) return '';
  return locale === 'en-US' && item.nameEn ? item.nameEn : item.nameZh;
}
