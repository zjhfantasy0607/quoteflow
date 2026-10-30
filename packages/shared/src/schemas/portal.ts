import { z } from 'zod';
import { PORTAL_QUOTE_TABS } from '../status';
import { idSchema, optionalText, pageQuerySchema } from './common';

// ---------- 供应商门户（M08） ----------

/** GET /api/portal/quotes（R08-1） */
export const portalQuoteListQuerySchema = pageQuerySchema.extend({
  /** 不传 = 全部 */
  tab: z.enum(PORTAL_QUOTE_TABS).optional(),
  /** 匹配正式询价号、标题 */
  keyword: optionalText(100),
});
export type PortalQuoteListQuery = z.infer<typeof portalQuoteListQuerySchema>;
export type PortalQuoteListParams = z.input<typeof portalQuoteListQuerySchema>;

// ---------- 报价填报（M09） ----------

/** R09-9：每次提交（每个版本）最多 10 个报价附件 */
export const QUOTE_ATTACHMENTS_MAX = 10;

/** 草稿最近一次写入的方式（02 §4），提交时决定 QuoteVersion.source */
export const QUOTE_DRAFT_SOURCES = ['ONLINE', 'EXCEL'] as const;
export type QuoteDraftSource = (typeof QUOTE_DRAFT_SOURCES)[number];

/** 报价取值 PplValue（02 §4）：decimal / money / percent 是字符串，int 是数字，multiEnum 是编码数组 */
export const pplValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/** Quote.draftValues（02 §4）：写入前已按冻结的列定义规范化，读出时按它校验结构 */
export const quoteDraftValuesSchema = z.object({
  /** 询价行 id → 供应商填写列的取值 */
  lines: z.record(z.string(), z.record(z.string(), pplValueSchema)),
  remark: z.string().optional(),
  changeNote: z.string().optional(),
  /** 提交时转成该版本的 Attachment(ownerType = QUOTE_VERSION) */
  attachmentFileIds: z.array(z.string()).optional(),
  source: z.enum(QUOTE_DRAFT_SOURCES).optional(),
});
export type QuoteDraftValues = z.infer<typeof quoteDraftValuesSchema>;

/** QuoteVersion.values（02 §4）：按行号排列，供应商填写列 + 服务端重算的公式列 */
export const quoteVersionValuesSchema = z.object({
  lines: z.array(
    z.object({
      lineId: z.string(),
      lineNo: z.number().int(),
      values: z.record(z.string(), pplValueSchema),
    }),
  ),
});
export type QuoteVersionValues = z.infer<typeof quoteVersionValuesSchema>;

/**
 * PUT /api/portal/quotes/:quoteId/draft、POST .../submit（R09-3、R09-4）。
 * lines 是"询价行 id → 列 key → 原始取值"，格式与必填由服务端按该轮冻结的列定义校验；
 * 附件超过 10 个由服务端返回 FILE_LIMIT_EXCEEDED
 */
export const quoteFormSchema = z.object({
  lines: z.record(idSchema, z.record(z.string().min(1).max(64), z.unknown())).default({}),
  /** 报价备注（整张报价） */
  remark: optionalText(1000),
  /** 本次提交的变更说明（#7） */
  changeNote: optionalText(1000),
  attachmentFileIds: z
    .array(idSchema)
    .max(100)
    .default([])
    .transform((ids) => [...new Set(ids)]),
});
export type QuoteFormInput = z.infer<typeof quoteFormSchema>;
export type QuoteFormParams = z.input<typeof quoteFormSchema>;

/** POST .../decline（R09-6）：原因编码（字典 decline_reason）和说明必填由服务端判断，未填返回 QUOTE_DECLINE_REASON_REQUIRED */
export const declineQuoteSchema = z.object({
  reasonCode: optionalText(50),
  reason: optionalText(500),
});
export type DeclineQuoteInput = z.infer<typeof declineQuoteSchema>;

/** 版本号路径参数 */
export const versionNoSchema = z.coerce.number().int().min(1).max(9999);
