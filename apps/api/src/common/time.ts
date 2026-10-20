import { APP_TZ, APP_TZ_LABEL } from '@quoteflow/shared';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 按业务时区（UTC+8）解释时间 */
export function inAppTz(date: Date | string): dayjs.Dayjs {
  return dayjs(date).tz(APP_TZ);
}

/** 邮件里的时间：2026-11-20 17:00（北京时间 UTC+8） / 2026-11-20 17:00 (Beijing Time, UTC+8) */
export function formatMailTime(date: Date | string, lang: 'zh-CN' | 'en-US'): string {
  const text = inAppTz(date).format('YYYY-MM-DD HH:mm');
  return lang === 'zh-CN' ? `${text}（北京时间 ${APP_TZ_LABEL}）` : `${text} (Beijing Time, ${APP_TZ_LABEL})`;
}
