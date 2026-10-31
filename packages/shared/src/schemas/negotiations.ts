import { z } from 'zod';
import { Dec } from '../decimal';
import { NEGOTIATION_RESPONSE_TYPES } from '../negotiation';
import { idSchema, optionalText } from './common';
import { quantitySchema } from './inquiries';

// ---------- 入围（M11 R11-6） ----------

/** 每轮最多入围 2 家（#8、I-7） */
export const SHORTLIST_LIMIT = 2;

/** PUT /api/inquiries/:id/rounds/:roundNo/shortlist：整份名单替换；超过 2 家由服务端返回 SHORTLIST_LIMIT_EXCEEDED */
export const shortlistSchema = z.object({
  quoteIds: z
    .array(idSchema)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
});
export type ShortlistInput = z.infer<typeof shortlistSchema>;

// ---------- 议价（M11 R11-7、R11-8，05 §5） ----------

export const NEGOTIATION_SPEC_NOTE_MAX = 500;
/** 方案说明 / 拒绝原因 */
export const NEGOTIATION_CONTENT_MAX = 1000;
/** R11-8：每条消息最多 10 个附件 */
export const NEGOTIATION_ATTACHMENTS_MAX = 10;
/** NegotiationMessage 附件的 Attachment.ownerType */
export const NEGOTIATION_MESSAGE_OWNER = 'NEGOTIATION_MESSAGE';

/** R11-8 目标价 / 反提案价格：≥ 0，最多 14 位整数、4 位小数 */
export const NEGOTIATION_PRICE_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

/** 空串、null 视为没填 */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

/** 接受十进制字符串或数字，输出规范的字符串（价格不在 JS number 上做运算） */
export const negotiationPriceSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .pipe(z.string().regex(NEGOTIATION_PRICE_PATTERN))
  .transform((v) => new Dec(v).toFixed());

/** 提案里的一行：含税单价、数量（> 0，最多 4 位小数）、规格说明，三者都可选 */
export const negotiationLineSchema = z.object({
  lineId: idSchema,
  unitPriceInclTax: z.preprocess(blankToUndefined, negotiationPriceSchema.optional()),
  quantity: z.preprocess(blankToUndefined, quantitySchema.optional()),
  specNote: optionalText(NEGOTIATION_SPEC_NOTE_MAX),
});
export type NegotiationLineInput = z.infer<typeof negotiationLineSchema>;
export type NegotiationLineParams = z.input<typeof negotiationLineSchema>;

/** 一行至少有价格、数量或规格说明之一（05 §5） */
export function hasNegotiationContent(line: NegotiationLineInput): boolean {
  return line.unitPriceInclTax !== undefined || line.quantity !== undefined || line.specNote !== undefined;
}

const proposalFields = {
  /** 什么都没填的行由服务端丢弃；一行都不剩时 NEGOTIATION_EMPTY_OFFER */
  lines: z
    .array(negotiationLineSchema)
    .max(1000)
    .default([])
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, {
      message: 'Duplicate lineId',
    }),
  content: optionalText(NEGOTIATION_CONTENT_MAX),
  /** 超过 10 个由服务端返回 FILE_LIMIT_EXCEEDED */
  attachmentFileIds: z
    .array(idSchema)
    .max(100)
    .default([])
    .transform((ids) => [...new Set(ids)]),
};

/** POST /api/quotes/:quoteId/negotiation/offer（采购方目标价） */
export const negotiationOfferSchema = z.object(proposalFields);
export type NegotiationOfferInput = z.infer<typeof negotiationOfferSchema>;
export type NegotiationOfferParams = z.input<typeof negotiationOfferSchema>;

/** POST /api/quotes/:quoteId/negotiation/accept：接受供应商的反提案 */
export const negotiationAcceptSchema = z.object({ messageId: idSchema });
export type NegotiationAcceptInput = z.infer<typeof negotiationAcceptSchema>;

/** POST /api/quotes/:quoteId/negotiation/close */
export const negotiationCloseSchema = z.object({ content: optionalText(NEGOTIATION_CONTENT_MAX) });
export type NegotiationCloseInput = z.infer<typeof negotiationCloseSchema>;

/**
 * POST /api/portal/quotes/:quoteId/negotiation/respond：replyToId 必须是最近一条（采购方的 OFFER）；
 * REJECT / COUNTER 的 content（原因）必填（NEGOTIATION_REASON_REQUIRED），COUNTER 至少一行（NEGOTIATION_EMPTY_OFFER），
 * ACCEPT 忽略 lines
 */
export const negotiationRespondSchema = z.object({
  type: z.enum(NEGOTIATION_RESPONSE_TYPES),
  replyToId: idSchema,
  ...proposalFields,
});
export type NegotiationRespondInput = z.infer<typeof negotiationRespondSchema>;
export type NegotiationRespondParams = z.input<typeof negotiationRespondSchema>;

/** NegotiationMessage.lines（02 §4）：只存填了的字段 */
export const negotiationMessageLinesSchema = z.array(
  z.object({
    lineId: z.string(),
    unitPriceInclTax: z.string().optional(),
    quantity: z.string().optional(),
    specNote: z.string().optional(),
  }),
);
export type NegotiationMessageLines = z.infer<typeof negotiationMessageLinesSchema>;
