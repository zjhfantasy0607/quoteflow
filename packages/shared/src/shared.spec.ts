import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  INQUIRY_TABS,
  INQUIRY_TAB_FILTER,
  InquiryDocStatus,
  RoundStatus,
  inquiryDisplayStatus,
  pageQuerySchema,
  queryBoolean,
} from './index';

describe('errors', () => {
  it('错误码不重复且都有合法的 HTTP 状态码', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_HTTP_STATUS[code]).toBeLessThan(600);
    }
  });
});

describe('inquiryDisplayStatus', () => {
  it('按 05 §2 映射', () => {
    expect(inquiryDisplayStatus(InquiryDocStatus.DRAFT, RoundStatus.DRAFT)).toBe('DRAFT');
    expect(inquiryDisplayStatus(InquiryDocStatus.PENDING_APPROVAL, RoundStatus.DRAFT)).toBe('PENDING_APPROVAL');
    expect(inquiryDisplayStatus(InquiryDocStatus.APPROVED, RoundStatus.DRAFT)).toBe('READY');
    expect(inquiryDisplayStatus(InquiryDocStatus.APPROVED, RoundStatus.WAITING_QUOTES)).toBe('WAITING_QUOTES');
    expect(inquiryDisplayStatus(InquiryDocStatus.APPROVED, RoundStatus.QUOTES_CLOSED)).toBe('QUOTES_CLOSED');
    expect(inquiryDisplayStatus(InquiryDocStatus.APPROVED, RoundStatus.OPENED)).toBe('OPENED');
    expect(inquiryDisplayStatus(InquiryDocStatus.APPROVED, RoundStatus.EVALUATED)).toBe('EVALUATED');
    expect(inquiryDisplayStatus(InquiryDocStatus.CANCELLED, RoundStatus.CANCELLED)).toBe('CANCELLED');
  });

  it('每个页签都有筛选条件', () => {
    for (const tab of INQUIRY_TABS) expect(INQUIRY_TAB_FILTER[tab]).toBeDefined();
  });
});

describe('common schemas', () => {
  it('分页默认值与上限', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(pageQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(pageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('查询布尔值不会把 "false" 当成 true', () => {
    expect(queryBoolean.parse('false')).toBe(false);
    expect(queryBoolean.parse('true')).toBe(true);
  });
});
