import {
  isNegotiationAutoClose,
  NEGOTIATION_PRICE_PATTERN,
  QUANTITY_PATTERN,
  type NegotiationLineParams,
  type NegotiationMessageDto,
  type NegotiationThreadDto,
} from '@quoteflow/shared';
import { i18n } from '@/i18n';

/** 目标价 / 反提案的处理结果（时间线上的状态标签，参考 PPT #30） */
export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'countered' | 'reoffered' | 'closed';

const REPLY_STATE: Record<NegotiationMessageDto['type'], ProposalState> = {
  ACCEPT: 'accepted',
  REJECT: 'rejected',
  COUNTER: 'countered',
  OFFER: 'reoffered',
  CLOSE: 'closed',
};

/** OFFER / COUNTER 被如何处理：看回复它的那条消息；还没回复时议价关闭了算"已结束"，否则"待回复"。其他消息为 null */
export function proposalState(
  thread: Pick<NegotiationThreadDto, 'status' | 'messages'>,
  message: NegotiationMessageDto,
): ProposalState | null {
  if (message.type !== 'OFFER' && message.type !== 'COUNTER') return null;
  const reply = thread.messages.find((m) => m.replyToId === message.id && m.seq > message.seq);
  if (reply) return REPLY_STATE[reply.type];
  return thread.status === 'CLOSED' ? 'closed' : 'pending';
}

/** 消息说明的显示文字：系统自动关闭的原因代码翻译成文字 */
export function messageContent(content: string | null): string {
  if (!content) return '';
  return isNegotiationAutoClose(content) ? i18n.global.t(`negotiation.autoClose.${content}`) : content;
}

/** 提案表单的一行（输入框里的字符串） */
export interface ProposalRow {
  lineId: string;
  price: string;
  quantity: string;
  specNote: string;
}

export type ProposalError = 'invalidPrice' | 'invalidQuantity' | 'emptyLines' | 'reasonRequired';

/**
 * R11-8 前端预检（以服务端为准）：价格 ≥ 0、最多 4 位小数；数量 > 0、最多 4 位小数；至少一行有内容；
 * 反提案、拒绝必须填原因。通过时返回要提交的行（没填的行不提交）
 */
export function buildProposal(
  rows: readonly ProposalRow[],
  options: { reasonRequired: boolean; content: string },
): { lines: NegotiationLineParams[] } | { error: ProposalError; lineId?: string } {
  const lines: NegotiationLineParams[] = [];
  for (const row of rows) {
    const price = row.price.trim();
    const quantity = row.quantity.trim();
    const specNote = row.specNote.trim();
    if (price && !NEGOTIATION_PRICE_PATTERN.test(price)) return { error: 'invalidPrice', lineId: row.lineId };
    if (quantity && (!QUANTITY_PATTERN.test(quantity) || !/[1-9]/.test(quantity)))
      return { error: 'invalidQuantity', lineId: row.lineId };
    if (!price && !quantity && !specNote) continue;
    lines.push({
      lineId: row.lineId,
      ...(price ? { unitPriceInclTax: price } : {}),
      ...(quantity ? { quantity } : {}),
      ...(specNote ? { specNote } : {}),
    });
  }
  if (lines.length === 0) return { error: 'emptyLines' };
  if (options.reasonRequired && !options.content.trim()) return { error: 'reasonRequired' };
  return { lines };
}
