import { describe, expect, it } from 'vitest';
import type { QuoteStatus, RoundStatus } from '../enums';
import { computePortalQuoteActions, isQuoteWindowOpen } from '../inquiry-actions';
import { declineQuoteSchema, quoteDraftValuesSchema, quoteFormSchema, versionNoSchema } from './portal';

const NOW = new Date('2026-11-02T01:00:00.000Z');
const DEADLINE = '2026-11-05T01:00:00.000Z';

const ctx = (quoteStatus: QuoteStatus, roundStatus: RoundStatus = 'WAITING_QUOTES', deadline = DEADLINE) => ({
  quoteStatus,
  roundStatus,
  deadline,
});

describe('R09-1 门户报价单的 allowedActions', () => {
  it('待报价、已提交可以保存草稿、提交、拒绝、下载与导入 Excel', () => {
    const all = ['saveDraft', 'submit', 'decline', 'downloadTemplate', 'importExcel'];
    expect(computePortalQuoteActions(ctx('INVITED'), NOW)).toEqual(all);
    expect(computePortalQuoteActions(ctx('SUBMITTED'), NOW)).toEqual(all);
  });

  it('R09-6 已拒绝的可以撤销拒绝重新提交，不能再拒绝', () => {
    expect(computePortalQuoteActions(ctx('DECLINED'), NOW)).toEqual([
      'saveDraft',
      'submit',
      'downloadTemplate',
      'importExcel',
    ]);
  });

  it('R09-1 截止判断只看当前时间：轮次仍是等待报价但已过截止也不能操作', () => {
    expect(computePortalQuoteActions(ctx('INVITED'), new Date(DEADLINE))).toEqual([]);
    expect(computePortalQuoteActions(ctx('INVITED'), new Date(new Date(DEADLINE).getTime() - 1))).toContain(
      'submit',
    );
    expect(isQuoteWindowOpen(ctx('INVITED', 'WAITING_QUOTES', new Date(DEADLINE).toISOString()), NOW)).toBe(
      true,
    );
  });

  it('R09-1 轮次不在等待报价、报价单作废或已进入评标都不能操作', () => {
    for (const round of ['QUOTES_CLOSED', 'OPENED', 'EVALUATED', 'SUPERSEDED', 'CANCELLED'] as const) {
      expect(computePortalQuoteActions(ctx('SUBMITTED', round), NOW)).toEqual([]);
    }
    for (const status of ['VOID', 'EVALUATING', 'WON', 'LOST'] as const) {
      expect(computePortalQuoteActions(ctx(status), NOW)).toEqual([]);
    }
    expect(computePortalQuoteActions({ ...ctx('INVITED'), deadline: null }, NOW)).toEqual([]);
  });
});

describe('M09 报价填报的请求体', () => {
  it('R09-3 草稿 / 提交：取值原样交给服务端校验，备注去空白，附件去重', () => {
    const parsed = quoteFormSchema.parse({
      lines: { l1: { unit_price_incl_tax: '1.5', tax_rate: 13, certifications: ['CE'] } },
      remark: '  含运费  ',
      changeNote: '',
      attachmentFileIds: ['f1', 'f2', 'f1'],
    });
    expect(parsed).toEqual({
      lines: { l1: { unit_price_incl_tax: '1.5', tax_rate: 13, certifications: ['CE'] } },
      remark: '含运费',
      changeNote: undefined,
      attachmentFileIds: ['f1', 'f2'],
    });
    expect(quoteFormSchema.parse({})).toEqual({ lines: {}, attachmentFileIds: [] });
    expect(quoteFormSchema.safeParse({ remark: 'x'.repeat(1001) }).success).toBe(false);
    expect(quoteFormSchema.safeParse({ lines: { l1: 'x' } }).success).toBe(false);
  });

  it('R09-6 拒绝：原因可以不传（由服务端返回 QUOTE_DECLINE_REASON_REQUIRED），说明最多 500 字', () => {
    expect(declineQuoteSchema.parse({ reasonCode: ' LEAD_TIME ', reason: ' 交期排满 ' })).toEqual({
      reasonCode: 'LEAD_TIME',
      reason: '交期排满',
    });
    expect(declineQuoteSchema.parse({ reason: '  ' })).toEqual({ reasonCode: undefined, reason: undefined });
    expect(declineQuoteSchema.safeParse({ reasonCode: 'OTHER', reason: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('草稿结构与版本号参数', () => {
    expect(
      quoteDraftValuesSchema.safeParse({ lines: { l1: { tax_rate: '13.00' } }, source: 'EXCEL' }).success,
    ).toBe(true);
    expect(quoteDraftValuesSchema.safeParse({ lines: { l1: { tax_rate: null } } }).success).toBe(false);
    expect(versionNoSchema.parse('2')).toBe(2);
    expect(versionNoSchema.safeParse('0').success).toBe(false);
  });
});
