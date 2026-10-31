import { NegotiationMsgType, NegotiationParty, NegotiationStatus, QuoteStatus, RoundStatus } from './enums';
import type { PermissionChecker } from './inquiry-actions';

// 议价的轮流规则（05 §5、M11 R11-7）：前端按它显示操作，后端用同一份规则复核

/** 议价线程的 allowedActions：采购方 offer / accept / close，供应商 accept / reject / counter */
export const NEGOTIATION_ACTIONS = ['offer', 'accept', 'close', 'reject', 'counter'] as const;
export type NegotiationAction = (typeof NEGOTIATION_ACTIONS)[number];

/** 供应商回复的消息类型（POST /api/portal/quotes/:quoteId/negotiation/respond） */
export const NEGOTIATION_RESPONSE_TYPES = ['ACCEPT', 'REJECT', 'COUNTER'] as const;
export type NegotiationResponseType = (typeof NEGOTIATION_RESPONSE_TYPES)[number];

/**
 * 系统自动关闭议价时 CLOSE 消息的 content（前端翻译显示）：定标（05 §5、R12-3）、询价取消（05 §1）、
 * 新一轮规格变更发布（05 §3）
 */
export const NEGOTIATION_AUTO_CLOSE = {
  award: 'AUTO_CLOSED_BY_AWARD',
  cancel: 'AUTO_CLOSED_BY_CANCEL',
  change: 'AUTO_CLOSED_BY_CHANGE',
} as const;
export type NegotiationAutoCloseReason = (typeof NEGOTIATION_AUTO_CLOSE)[keyof typeof NEGOTIATION_AUTO_CLOSE];

export function isNegotiationAutoClose(
  content: string | null | undefined,
): content is NegotiationAutoCloseReason {
  return Object.values(NEGOTIATION_AUTO_CLOSE).includes(content as NegotiationAutoCloseReason);
}

/** 最近一条消息 */
export interface NegotiationLastMessage {
  party: NegotiationParty;
  type: NegotiationMsgType;
}

/** 下一步由谁、可以发哪些消息 */
export interface NegotiationNextMoves {
  party: NegotiationParty | null;
  types: NegotiationMsgType[];
}

/**
 * 05 §5 的轮流表：没有消息 → 采购方 OFFER；采购方 OFFER → 供应商 ACCEPT / REJECT / COUNTER；
 * 供应商 REJECT → 采购方 OFFER / CLOSE；供应商 COUNTER → 采购方 ACCEPT / OFFER / CLOSE；
 * 任一方 ACCEPT（成交）→ 采购方 OFFER（再议）；CLOSE → 终态
 */
export function negotiationNextMoves(last: NegotiationLastMessage | null): NegotiationNextMoves {
  const { BUYER, SUPPLIER } = NegotiationParty;
  const { OFFER, COUNTER, ACCEPT, REJECT, CLOSE } = NegotiationMsgType;
  if (!last) return { party: BUYER, types: [OFFER] };
  switch (last.type) {
    case OFFER:
      return { party: SUPPLIER, types: [ACCEPT, REJECT, COUNTER] };
    case REJECT:
      return { party: BUYER, types: [OFFER, CLOSE] };
    case COUNTER:
      return { party: BUYER, types: [ACCEPT, OFFER, CLOSE] };
    case ACCEPT:
      return { party: BUYER, types: [OFFER] };
    case CLOSE:
      return { party: null, types: [] };
  }
}

export interface NegotiationContext {
  roundStatus: RoundStatus;
  quoteStatus: QuoteStatus;
  shortlisted: boolean;
  /** 还没有议价时为 null */
  status: NegotiationStatus | null;
  last: NegotiationLastMessage | null;
}

/** 05 §5 前置条件：轮次开标中（OPENED）、报价单评标中且已入围 */
export function canNegotiate(
  ctx: Pick<NegotiationContext, 'roundStatus' | 'quoteStatus' | 'shortlisted'>,
): boolean {
  return (
    ctx.roundStatus === RoundStatus.OPENED && ctx.quoteStatus === QuoteStatus.EVALUATING && ctx.shortlisted
  );
}

/** 轮到谁回复；不能议价或已关闭时为 null */
export function negotiationAwaiting(ctx: NegotiationContext): NegotiationParty | null {
  if (!canNegotiate(ctx) || ctx.status === NegotiationStatus.CLOSED) return null;
  return negotiationNextMoves(ctx.last).party;
}

const BUYER_ACTION: Partial<Record<NegotiationMsgType, NegotiationAction>> = {
  OFFER: 'offer',
  ACCEPT: 'accept',
  CLOSE: 'close',
};
const SUPPLIER_ACTION: Partial<Record<NegotiationMsgType, NegotiationAction>> = {
  ACCEPT: 'accept',
  REJECT: 'reject',
  COUNTER: 'counter',
};

/** 采购方（需要 inquiry:evaluate）现在能做的议价动作 */
export function computeBuyerNegotiationActions(
  ctx: NegotiationContext,
  perms: PermissionChecker,
): NegotiationAction[] {
  if (!perms.has('inquiry:evaluate') || negotiationAwaiting(ctx) !== NegotiationParty.BUYER) return [];
  return negotiationNextMoves(ctx.last).types.map((type) => BUYER_ACTION[type]!);
}

/** 供应商现在能做的议价回复 */
export function computeSupplierNegotiationActions(ctx: NegotiationContext): NegotiationAction[] {
  if (negotiationAwaiting(ctx) !== NegotiationParty.SUPPLIER) return [];
  return negotiationNextMoves(ctx.last).types.map((type) => SUPPLIER_ACTION[type]!);
}
