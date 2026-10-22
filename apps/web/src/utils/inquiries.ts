import { i18n } from '@/i18n';

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
