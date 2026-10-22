import { beforeEach, describe, expect, it } from 'vitest';
import { applyLocale } from '@/i18n';
import { inquiryNo, remainingText } from './inquiries';

describe('inquiryNo', () => {
  it('有正式询价号显示正式号，否则草稿号（M06 §5）', () => {
    expect(inquiryNo({ formalNo: 'RFQ-202611-0001', draftNo: 'DR-20261102-0001' })).toBe('RFQ-202611-0001');
    expect(inquiryNo({ formalNo: null, draftNo: 'DR-20261102-0001' })).toBe('DR-20261102-0001');
  });
});

describe('remainingText', () => {
  const now = Date.parse('2026-11-02T01:00:00.000Z');
  const later = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  beforeEach(() => applyLocale('zh-CN'));

  it('按天、小时、分钟显示剩余时间，已截止返回 null', () => {
    expect(remainingText(later(2 * 1440 + 3 * 60 + 5), now)).toBe('2 天 3 小时');
    expect(remainingText(later(5 * 60 + 30), now)).toBe('5 小时 30 分钟');
    expect(remainingText(later(12), now)).toBe('12 分钟');
    expect(remainingText(later(0), now)).toBeNull();
    expect(remainingText(later(-10), now)).toBeNull();
  });

  it('英文界面', () => {
    applyLocale('en-US');
    expect(remainingText(later(1440 + 60), now)).toBe('1 d 1 h');
  });
});
