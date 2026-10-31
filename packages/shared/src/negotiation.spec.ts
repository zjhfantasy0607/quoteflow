import { describe, expect, it } from 'vitest';
import type { NegotiationMsgType, NegotiationParty } from './enums';
import { computeInquiryActions, computePortalQuoteActions } from './inquiry-actions';
import {
  canNegotiate,
  computeBuyerNegotiationActions,
  computeSupplierNegotiationActions,
  isNegotiationAutoClose,
  negotiationAwaiting,
  negotiationNextMoves,
  type NegotiationContext,
} from './negotiation';
import { PRESET_ROLES } from './roles';
import {
  hasNegotiationContent,
  negotiationLineSchema,
  negotiationOfferSchema,
  negotiationRespondSchema,
  shortlistSchema,
} from './schemas/negotiations';

const perms = (role: string) => new Set<string>(PRESET_ROLES.find((r) => r.code === role)!.permissions);
const msg = (party: NegotiationParty, type: NegotiationMsgType) => ({ party, type });
const ctx = (
  last: NegotiationContext['last'],
  extra: Partial<NegotiationContext> = {},
): NegotiationContext => ({
  roundStatus: 'OPENED',
  quoteStatus: 'EVALUATING',
  shortlisted: true,
  status: last ? 'OPEN' : null,
  last,
  ...extra,
});

describe('R11-7 议价轮流规则（05 §5）', () => {
  it('没有消息时只有采购方能发 OFFER', () => {
    expect(negotiationNextMoves(null)).toEqual({ party: 'BUYER', types: ['OFFER'] });
    expect(computeBuyerNegotiationActions(ctx(null), perms('BUYER'))).toEqual(['offer']);
    expect(computeSupplierNegotiationActions(ctx(null))).toEqual([]);
  });

  it('采购方 OFFER 之后轮到供应商：接受、拒绝、反提案；采购方不能连发两次 OFFER', () => {
    const c = ctx(msg('BUYER', 'OFFER'));
    expect(negotiationAwaiting(c)).toBe('SUPPLIER');
    expect(computeSupplierNegotiationActions(c)).toEqual(['accept', 'reject', 'counter']);
    expect(computeBuyerNegotiationActions(c, perms('BUYER'))).toEqual([]);
  });

  it('供应商 REJECT → 采购方 OFFER / CLOSE；COUNTER → 采购方 ACCEPT / OFFER / CLOSE', () => {
    expect(computeBuyerNegotiationActions(ctx(msg('SUPPLIER', 'REJECT')), perms('BUYER'))).toEqual([
      'offer',
      'close',
    ]);
    expect(computeBuyerNegotiationActions(ctx(msg('SUPPLIER', 'COUNTER')), perms('BUYER'))).toEqual([
      'accept',
      'offer',
      'close',
    ]);
    expect(computeSupplierNegotiationActions(ctx(msg('SUPPLIER', 'COUNTER')))).toEqual([]);
  });

  it('R11-9 成交（任一方 ACCEPT）后采购方可以再发 OFFER', () => {
    for (const party of ['BUYER', 'SUPPLIER'] as const) {
      const c = ctx(msg(party, 'ACCEPT'), { status: 'AGREED' });
      expect(computeBuyerNegotiationActions(c, perms('BUYER'))).toEqual(['offer']);
      expect(computeSupplierNegotiationActions(c)).toEqual([]);
    }
  });

  it('CLOSE 之后双方都不能再操作', () => {
    const c = ctx(msg('BUYER', 'CLOSE'), { status: 'CLOSED' });
    expect(negotiationAwaiting(c)).toBeNull();
    expect(computeBuyerNegotiationActions(c, perms('PURCHASE_MANAGER'))).toEqual([]);
    expect(computeSupplierNegotiationActions(c)).toEqual([]);
  });

  it('前置条件：轮次开标中、报价单评标中且已入围；采购方还要有 inquiry:evaluate', () => {
    expect(canNegotiate(ctx(null))).toBe(true);
    expect(canNegotiate(ctx(null, { shortlisted: false }))).toBe(false);
    expect(canNegotiate(ctx(null, { roundStatus: 'EVALUATED' }))).toBe(false);
    expect(canNegotiate(ctx(null, { quoteStatus: 'LOST' }))).toBe(false);
    expect(computeBuyerNegotiationActions(ctx(null, { shortlisted: false }), perms('BUYER'))).toEqual([]);
    expect(computeBuyerNegotiationActions(ctx(null), perms('CONTRACT_APPROVER'))).toEqual([]);
    expect(
      computeSupplierNegotiationActions(ctx(msg('BUYER', 'OFFER'), { roundStatus: 'EVALUATED' })),
    ).toEqual([]);
  });

  it('系统自动关闭的原因代码', () => {
    expect(isNegotiationAutoClose('AUTO_CLOSED_BY_AWARD')).toBe(true);
    expect(isNegotiationAutoClose('AUTO_CLOSED_BY_CANCEL')).toBe(true);
    expect(isNegotiationAutoClose('价格谈不拢')).toBe(false);
    expect(isNegotiationAutoClose(null)).toBe(false);
  });
});

describe('M11 allowedActions', () => {
  const inquiry = (
    currentRoundStatus: 'QUOTES_CLOSED' | 'OPENED' | 'EVALUATED' | 'CANCELLED',
    extra = {},
  ) => ({
    docStatus: currentRoundStatus === 'CANCELLED' ? ('CANCELLED' as const) : ('APPROVED' as const),
    currentRoundNo: 1,
    currentRoundStatus,
    ...extra,
  });
  const actions = (c: ReturnType<typeof inquiry>, role: string) =>
    computeInquiryActions(c, perms(role)).filter((a) =>
      ['evaluate', 'shortlist', 'exportMatrix'].includes(a),
    );

  it('R11-1 开标前没有比价；开标后采购员能看比价、入围、导出；定标后只能看和导出', () => {
    expect(actions(inquiry('QUOTES_CLOSED'), 'BUYER')).toEqual([]);
    expect(actions(inquiry('OPENED'), 'BUYER')).toEqual(['evaluate', 'exportMatrix', 'shortlist']);
    expect(actions(inquiry('EVALUATED'), 'BUYER')).toEqual(['evaluate', 'exportMatrix']);
  });

  it('R11-1 开标后才被取消的轮次仍可查看比价；从未开标就取消的不行', () => {
    expect(actions(inquiry('CANCELLED'), 'BUYER')).toEqual([]);
    expect(
      actions(inquiry('CANCELLED', { currentRoundOpenedAt: '2026-11-02T01:00:00.000Z' }), 'BUYER'),
    ).toEqual(['evaluate', 'exportMatrix']);
  });

  it('R11-5 合同批准人、管理员没有 inquiry:evaluate / inquiry:export', () => {
    expect(actions(inquiry('OPENED'), 'CONTRACT_APPROVER')).toEqual([]);
    expect(actions(inquiry('OPENED'), 'ADMIN')).toEqual([]);
  });

  it('门户：轮到供应商回复议价时有 respondNegotiation（与报价窗口无关）', () => {
    const now = new Date('2026-11-10T01:00:00.000Z');
    const base = {
      quoteStatus: 'EVALUATING' as const,
      roundStatus: 'OPENED' as const,
      deadline: '2026-11-05T01:00:00.000Z',
    };
    const negotiation = (last: NegotiationContext['last']) => ({
      shortlisted: true,
      status: 'OPEN' as const,
      last,
    });
    expect(computePortalQuoteActions(base, now)).toEqual([]);
    expect(
      computePortalQuoteActions({ ...base, negotiation: negotiation(msg('BUYER', 'OFFER')) }, now),
    ).toEqual(['respondNegotiation']);
    expect(
      computePortalQuoteActions({ ...base, negotiation: negotiation(msg('SUPPLIER', 'COUNTER')) }, now),
    ).toEqual([]);
  });
});

describe('R11-6 R11-8 入围与议价的请求体', () => {
  it('R11-6 入围名单去重；超过 2 家由服务端判断', () => {
    expect(shortlistSchema.parse({ quoteIds: ['a', 'b', 'a', 'c'] }).quoteIds).toEqual(['a', 'b', 'c']);
  });

  it('R11-8 价格 ≥ 0、最多 4 位小数，输出规范的十进制字符串', () => {
    const price = (v: unknown) => negotiationLineSchema.safeParse({ lineId: 'l1', unitPriceInclTax: v });
    expect(price('2.3500').data?.unitPriceInclTax).toBe('2.35');
    expect(price(0).data?.unitPriceInclTax).toBe('0');
    expect(price(' 1.1234 ').data?.unitPriceInclTax).toBe('1.1234');
    expect(price('1.12345').success).toBe(false);
    expect(price('-1').success).toBe(false);
    expect(price('1e3').success).toBe(false);
    expect(price('').data?.unitPriceInclTax).toBeUndefined();
    expect(price(null).data?.unitPriceInclTax).toBeUndefined();
  });

  it('R11-8 数量 > 0、最多 4 位小数；规格说明最多 500 字', () => {
    const line = (extra: Record<string, unknown>) =>
      negotiationLineSchema.safeParse({ lineId: 'l1', ...extra });
    expect(line({ quantity: '5000.0' }).data?.quantity).toBe('5000');
    expect(line({ quantity: '0' }).success).toBe(false);
    expect(line({ quantity: '1.00001' }).success).toBe(false);
    expect(line({ specNote: 'x'.repeat(500) }).success).toBe(true);
    expect(line({ specNote: 'x'.repeat(501) }).success).toBe(false);
    expect(line({ specNote: '  ' }).data?.specNote).toBeUndefined();
  });

  it('什么都没填的行能通过校验，由服务端丢弃并判断 NEGOTIATION_EMPTY_OFFER', () => {
    const parsed = negotiationOfferSchema.parse({
      lines: [{ lineId: 'l1' }, { lineId: 'l2', specNote: '改为哑光' }],
    });
    expect(parsed.lines.map(hasNegotiationContent)).toEqual([false, true]);
    expect(parsed.attachmentFileIds).toEqual([]);
    expect(negotiationOfferSchema.safeParse({ lines: [{ lineId: 'l1' }, { lineId: 'l1' }] }).success).toBe(
      false,
    );
  });

  it('供应商回复：类型只能是 ACCEPT / REJECT / COUNTER，必须带 replyToId', () => {
    expect(negotiationRespondSchema.safeParse({ type: 'ACCEPT', replyToId: 'm1' }).success).toBe(true);
    expect(negotiationRespondSchema.safeParse({ type: 'OFFER', replyToId: 'm1' }).success).toBe(false);
    expect(negotiationRespondSchema.safeParse({ type: 'REJECT' }).success).toBe(false);
  });
});
