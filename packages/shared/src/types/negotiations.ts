import type { NegotiationMsgType, NegotiationParty, NegotiationStatus, QuoteStatus } from '../enums';
import type { NegotiationAction } from '../negotiation';
import type { FileDto } from './infra';

// 议价（M11）：采购方（GET /api/quotes/:quoteId/negotiation）与门户（GET /api/portal/quotes/:quoteId/negotiation）共用

/** 提案里的一行（目标价 / 反提案） */
export interface NegotiationLineProposalDto {
  lineId: string;
  lineNo: number;
  /** 含税单价；采购方没有 negotiation.amount 时为 null（R11-10） */
  unitPriceInclTax: string | null;
  quantity: string | null;
  specNote: string | null;
}

/** 时间线里的一条消息（R11-11），按 seq 升序 */
export interface NegotiationMessageDto {
  id: string;
  seq: number;
  /** 议价第几轮：采购方每发一次 OFFER 加 1 */
  negotiationRound: number;
  party: NegotiationParty;
  type: NegotiationMsgType;
  /** OFFER / COUNTER 的提案，按行号 */
  lines: NegotiationLineProposalDto[];
  /** 方案说明 / 拒绝原因；系统自动关闭时是 NEGOTIATION_AUTO_CLOSE 里的代码 */
  content: string | null;
  replyToId: string | null;
  author: { name: string };
  createdAt: string;
  attachments: FileDto[];
  /** ACCEPT（成交）生成的报价版本号 */
  resultVersionNo: number | null;
  /** 被脱敏的字段：unitPriceInclTax（negotiation.amount） */
  maskedFields?: string[];
}

/** 议价表单的参照行：询价行与当前版本的价格、数量 */
export interface NegotiationLineRefDto {
  lineId: string;
  lineNo: number;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  unitNameZh: string;
  unitNameEn: string | null;
  /** 询价行数量 */
  quantity: string;
  /** 当前版本的含税单价；采购方没有 quote.amount 时为 null */
  currentUnitPrice: string | null;
  /** 当前版本的数量（议价改过时是议价数量，否则等于询价行数量） */
  currentQuantity: string;
}

/** 一张报价单的议价线程 */
export interface NegotiationThreadDto {
  quoteId: string;
  supplier: { id: string; code: string; nameZh: string; nameEn: string | null };
  quoteStatus: QuoteStatus;
  shortlisted: boolean;
  /** 还没有发过议价时为 null */
  status: NegotiationStatus | null;
  /** 轮到谁回复；不能议价或已关闭时为 null */
  awaiting: NegotiationParty | null;
  /** 字典 currency */
  currency: string;
  currentVersionNo: number | null;
  lines: NegotiationLineRefDto[];
  messages: NegotiationMessageDto[];
  /** 采购方：offer / accept / close；门户：accept / reject / counter */
  allowedActions: NegotiationAction[];
  /** 被脱敏的字段：currentUnitPrice（quote.amount） */
  maskedFields?: string[];
}
