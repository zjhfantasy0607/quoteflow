import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, pickName } from './format';

describe('formatDateTime', () => {
  it('UTC 时间按 UTC+8 显示', () => {
    expect(formatDateTime('2026-10-31T17:00:00.000Z')).toBe('2026-11-01 01:00');
    expect(formatDateTime('2026-10-31T17:00:05.000Z', { seconds: true })).toBe('2026-11-01 01:00:05');
    expect(formatDate('2026-10-31T17:00:00.000Z')).toBe('2026-11-01');
  });

  it('空值返回空串', () => {
    expect(formatDateTime(null)).toBe('');
  });
});

describe('formatMoney', () => {
  it('千分位且不经过浮点', () => {
    expect(formatMoney('12800.5', 2)).toBe('12,800.50');
    expect(formatMoney('1234567.0850')).toBe('1,234,567.0850');
    expect(formatMoney('0.1', 4)).toBe('0.1000');
    expect(formatMoney('-950')).toBe('-950');
    expect(formatMoney('99999999999999999.99')).toBe('99,999,999,999,999,999.99');
  });

  it('空值返回空串', () => {
    expect(formatMoney(null)).toBe('');
  });
});

describe('pickName', () => {
  it('英文界面优先英文名，缺失时回退中文', () => {
    expect(pickName({ nameZh: '灯珠', nameEn: 'LED Beads' }, 'en-US')).toBe('LED Beads');
    expect(pickName({ nameZh: '灯珠', nameEn: null }, 'en-US')).toBe('灯珠');
    expect(pickName({ nameZh: '灯珠', nameEn: 'LED Beads' }, 'zh-CN')).toBe('灯珠');
  });
});
