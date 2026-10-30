import dayjs from 'dayjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLocale } from '@/i18n';
import {
  DEADLINE_INPUT_FORMAT,
  deadlineInputToIso,
  deadlineShortcut,
  extendedDeadline,
  inquiryNo,
  isBeforeAppToday,
  isoToDeadlineInput,
  remainingText,
} from './inquiries';

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

describe('截止时间选择器（M07，按北京时间）', () => {
  it('选择器的值按 UTC+8 解释，与浏览器时区无关', () => {
    expect(deadlineInputToIso('2026-11-05 18:00')).toBe('2026-11-05T10:00:00.000Z');
    expect(isoToDeadlineInput('2026-11-05T10:00:00.000Z')).toBe('2026-11-05 18:00');
    // 跨日：UTC 前一天 20:00 是北京时间次日 04:00
    expect(isoToDeadlineInput('2026-11-04T20:00:00.000Z')).toBe('2026-11-05 04:00');
  });

  it('快捷选项是北京时间 N 天后的 18:00', () => {
    // 北京时间 2026-11-02 23:30
    const now = Date.parse('2026-11-02T15:30:00.000Z');
    const value = dayjs(deadlineShortcut(3, now)).format(DEADLINE_INPUT_FORMAT);
    expect(value).toBe('2026-11-05 18:00');
    expect(deadlineInputToIso(value)).toBe('2026-11-05T10:00:00.000Z');
  });

  it('早于北京时间今天的日期不能选', () => {
    const now = Date.parse('2026-11-02T15:30:00.000Z'); // 北京时间 11-02 23:30
    expect(isBeforeAppToday(new Date(2026, 10, 1), now)).toBe(true);
    expect(isBeforeAppToday(new Date(2026, 10, 2), now)).toBe(false);
    expect(isBeforeAppToday(new Date(2026, 10, 3), now)).toBe(false);
  });
});

describe('延期快捷选项', () => {
  it('在原截止时间（北京时间）上顺延 N 天，时分不变', () => {
    const value = dayjs(extendedDeadline('2026-11-05T01:30:00.000Z', 3)).format(DEADLINE_INPUT_FORMAT);
    expect(value).toBe('2026-11-08 09:30');
  });
});
