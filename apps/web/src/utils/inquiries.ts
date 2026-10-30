import { APP_TZ } from '@quoteflow/shared';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { i18n } from '@/i18n';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 单号：有正式询价号显示正式号，否则草稿号（M06 §5） */
export function inquiryNo(inquiry: { formalNo: string | null; draftNo: string }): string {
  return inquiry.formalNo ?? inquiry.draftNo;
}

/** 距截止还剩多久（如"2 天 3 小时"）；已截止返回 null */
export function remainingText(deadline: string, now: number = Date.now()): string | null {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  const t = i18n.global.t;
  if (d > 0) return t('inquiries.duration.days', { d, h });
  if (h > 0) return t('inquiries.duration.hours', { h, m });
  return t('inquiries.duration.minutes', { m });
}

/**
 * 截止时间选择器（M07）的值是北京时间（UTC+8）的"YYYY-MM-DD HH:mm"，与浏览器所在时区无关；
 * 提交前转成 ISO（UTC），回显时再转回来
 */
export const DEADLINE_INPUT_FORMAT = 'YYYY-MM-DD HH:mm';

export function deadlineInputToIso(value: string): string {
  return dayjs.tz(value, APP_TZ).toISOString();
}

export function isoToDeadlineInput(iso: string): string {
  return dayjs(iso).tz(APP_TZ).format(DEADLINE_INPUT_FORMAT);
}

/**
 * el-date-picker 按浏览器本地时间把快捷选项的 Date 格式化成值，
 * 所以构造一个本地墙上时间等于目标北京时间的 Date
 */
function wallDate(target: dayjs.Dayjs): Date {
  return new Date(target.year(), target.month(), target.date(), target.hour(), target.minute());
}

/** 发布的快捷选项：北京时间 N 天后的 18:00 */
export function deadlineShortcut(days: number, now: number = Date.now()): Date {
  return wallDate(dayjs(now).tz(APP_TZ).add(days, 'day').hour(18).minute(0));
}

/** 延期的快捷选项：原截止时间往后 N 天，时分不变 */
export function extendedDeadline(iso: string, days: number): Date {
  return wallDate(dayjs(iso).tz(APP_TZ).add(days, 'day'));
}

/** 日历里早于北京时间今天的日期不能选（日历格子是本地时间当天 0 点） */
export function isBeforeAppToday(date: Date, now: number = Date.now()): boolean {
  return dayjs(date).format('YYYY-MM-DD') < dayjs(now).tz(APP_TZ).format('YYYY-MM-DD');
}
