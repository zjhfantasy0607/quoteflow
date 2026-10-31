import type { NegotiationMessageDto } from '@quoteflow/shared';
import { describe, expect, it } from 'vitest';
import { applyLocale } from '@/i18n';
import { buildProposal, messageContent, proposalState, type ProposalRow } from './negotiation';

let seq = 0;
function msg(
  type: NegotiationMessageDto['type'],
  replyTo: NegotiationMessageDto | null = null,
  extra: Partial<NegotiationMessageDto> = {},
): NegotiationMessageDto {
  seq += 1;
  return {
    id: `m${seq}`,
    seq,
    negotiationRound: 1,
    party: type === 'OFFER' || type === 'CLOSE' ? 'BUYER' : 'SUPPLIER',
    type,
    lines: [],
    content: null,
    replyToId: replyTo?.id ?? null,
    author: { name: 'x' },
    createdAt: '2026-11-30T01:00:00.000Z',
    attachments: [],
    resultVersionNo: null,
    ...extra,
  };
}

const row = (extra: Partial<ProposalRow> = {}): ProposalRow => ({
  lineId: 'l1',
  price: '',
  quantity: '',
  specNote: '',
  ...extra,
});

describe('R11-11 议价时间线的状态', () => {
  it('目标价 / 反提案按回复它的消息显示：接受、拒绝、反提案、重新出价', () => {
    const offer = msg('OFFER');
    const counter = msg('COUNTER', offer);
    const reoffer = msg('OFFER', counter);
    const accept = msg('ACCEPT', reoffer);
    const thread = { status: 'AGREED' as const, messages: [offer, counter, reoffer, accept] };
    expect([offer, counter, reoffer, accept].map((m) => proposalState(thread, m))).toEqual([
      'countered',
      'reoffered',
      'accepted',
      null,
    ]);
    const reject = msg('REJECT', offer);
    expect(proposalState({ status: 'OPEN', messages: [offer, reject] }, offer)).toBe('rejected');
  });

  it('最后一条提案还没回复时是"待回复"，议价关闭了是"已结束"', () => {
    const offer = msg('OFFER');
    expect(proposalState({ status: 'OPEN', messages: [offer] }, offer)).toBe('pending');
    expect(proposalState({ status: 'CLOSED', messages: [offer] }, offer)).toBe('closed');
  });

  it('系统自动关闭的原因代码翻译成文字，普通说明原样显示', () => {
    applyLocale('zh-CN');
    expect(messageContent('AUTO_CLOSED_BY_CANCEL')).toBe('询价已取消，系统自动结束议价');
    expect(messageContent('价格谈不拢')).toBe('价格谈不拢');
    expect(messageContent(null)).toBe('');
  });
});

describe('R11-8 提案表单预检', () => {
  it('没填的行不提交，填了的只带有值的字段', () => {
    const res = buildProposal([row({ price: ' 1.05 ', specNote: '哑光' }), row({ lineId: 'l2' })], {
      reasonRequired: false,
      content: '',
    });
    expect(res).toEqual({ lines: [{ lineId: 'l1', unitPriceInclTax: '1.05', specNote: '哑光' }] });
  });

  it('价格最多 4 位小数且不能为负；数量必须大于 0', () => {
    const check = (r: ProposalRow) => buildProposal([r], { reasonRequired: false, content: '' });
    expect(check(row({ price: '1.12345' }))).toEqual({ error: 'invalidPrice', lineId: 'l1' });
    expect(check(row({ price: '-1' }))).toMatchObject({ error: 'invalidPrice' });
    expect(check(row({ quantity: '0' }))).toMatchObject({ error: 'invalidQuantity' });
    expect(check(row({ quantity: '1.00001' }))).toMatchObject({ error: 'invalidQuantity' });
    expect(check(row({ price: '0', quantity: '1200' }))).toEqual({
      lines: [{ lineId: 'l1', unitPriceInclTax: '0', quantity: '1200' }],
    });
  });

  it('至少一行有内容；反提案必须填原因', () => {
    expect(buildProposal([row()], { reasonRequired: false, content: '' })).toEqual({ error: 'emptyLines' });
    expect(buildProposal([row({ price: '1' })], { reasonRequired: true, content: '  ' })).toEqual({
      error: 'reasonRequired',
    });
  });
});
