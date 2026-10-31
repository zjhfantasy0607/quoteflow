import { z } from 'zod';
import { NegotiationMsgType, NegotiationParty, QuoteVersionSource } from '../enums';
import { pplColumnSchema } from '../ppl/definition';
import { INQUIRY_FILE_KINDS } from './inquiries';
import { negotiationMessageLinesSchema } from './negotiations';
import { quoteVersionValuesSchema } from './portal';

// ---------- 合同快照（02 §4，M12 定标时生成，M14 展示与打印） ----------

/** 字典项、分类的编码与中英文名称（定标时的名称，之后主数据怎么改都不影响） */
const codeNameSchema = z.object({ code: z.string(), nameZh: z.string(), nameEn: z.string() });

/** 该轮冻结的列定义（变体解析后，required 已合并为 boolean） */
export const pplResolvedColumnSchema = pplColumnSchema.extend({ required: z.boolean() });

/**
 * Contract.snapshot：定标时冻结的询价与中标报价（R12-5、#25），写入前按它校验。
 * 金额（quoteVersion.totalAmount 与 values 里的金额列）在 M14 按 contract.amount 脱敏
 */
export const contractSnapshotSchema = z.object({
  capturedAt: z.string(),
  inquiry: z.object({
    id: z.string(),
    formalNo: z.string(),
    projectNo: z.string(),
    title: z.string(),
    /** 字典 currency */
    currency: z.string(),
    roundNo: z.number().int(),
    materialCategory: codeNameSchema,
    owner: z.object({ id: z.string(), name: z.string() }),
  }),
  /** 中标轮次的询价行，按行号 */
  lines: z.array(
    z.object({
      lineId: z.string(),
      lineNo: z.number().int(),
      materialCode: z.string().nullable(),
      nameZh: z.string(),
      nameEn: z.string().nullable(),
      spec: z.string(),
      unit: codeNameSchema,
      /** 询价行数量（议价改过的数量在 quoteVersion.values 的 quantity 里） */
      quantity: z.string(),
      category: codeNameSchema,
    }),
  ),
  supplier: z.object({
    id: z.string(),
    code: z.string(),
    nameZh: z.string(),
    nameEn: z.string().nullable(),
    contactName: z.string(),
    contactEmail: z.string(),
    contactPhone: z.string().nullable(),
  }),
  /** 中标版本（定标时报价单的当前版本，可能是议价成交生成的版本） */
  quoteVersion: z.object({
    id: z.string(),
    versionNo: z.number().int(),
    source: z.enum(QuoteVersionSource),
    submittedAt: z.string(),
    /** 含税合计，2 位小数 */
    totalAmount: z.string(),
    currency: z.string(),
    values: quoteVersionValuesSchema,
    remark: z.string().nullable(),
    changeNote: z.string().nullable(),
    templateVersion: z.number().int(),
    variantCode: z.string(),
    /** 该版本的报价附件 */
    attachments: z.array(z.object({ fileId: z.string(), originalName: z.string() })),
  }),
  /** 该轮冻结的列定义，用于渲染字段标签 */
  columns: z.array(pplResolvedColumnSchema),
  /** 与中标方的议价记录（按 seq）；没有议价为 null */
  negotiation: z
    .array(
      z.object({
        seq: z.number().int(),
        party: z.enum(NegotiationParty),
        type: z.enum(NegotiationMsgType),
        lines: negotiationMessageLinesSchema,
        content: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .nullable(),
  /** 中标轮次的规格书与产品图：整单附件 lineNo 为 null */
  files: z.array(
    z.object({
      fileId: z.string(),
      originalName: z.string(),
      kind: z.enum(INQUIRY_FILE_KINDS),
      lineNo: z.number().int().nullable(),
    }),
  ),
});
export type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;
