import type {
  NegotiationParty,
  NegotiationStatus,
  QuoteStatus,
  QuoteVersionSource,
  RoundStatus,
} from '../enums';
import type { PplResolvedColumn } from '../ppl/definition';
import type { PplValue } from '../ppl/values';
import type { FileDto } from './infra';
import type { PplResolvedDto } from './ppl';

// 报价版本（M09）：门户（供应商看自己的）与采购方（M10 起，开标后、受密封与脱敏约束）共用

/** 版本里一行的取值：供应商填写列 + 服务端重算的公式列（02 §4）；被脱敏的金额列为 null */
export interface QuoteVersionLineDto {
  lineId: string;
  lineNo: number;
  values: Record<string, PplValue | null>;
}

/** 版本列表的一项（R09-7，按版本号倒序） */
export interface QuoteVersionSummaryDto {
  versionNo: number;
  source: QuoteVersionSource;
  submittedAt: string;
  submittedBy: { name: string };
  /** 含税总价合计（2 位小数）；被脱敏时为 null */
  totalAmount: string | null;
  /** 字典 currency */
  currency: string;
  remark: string | null;
  changeNote: string | null;
  attachmentCount: number;
  /** 被脱敏的字段：totalAmount 和金额敏感列的 key（05 §10） */
  maskedFields?: string[];
}

/** 版本详情（只读，版本创建后不可修改，I-6） */
export interface QuoteVersionDto extends QuoteVersionSummaryDto {
  templateVersion: number;
  variantCode: string;
  lines: QuoteVersionLineDto[];
  attachments: FileDto[];
}

/**
 * GET /api/inquiries/:id/rounds/:roundNo/quotes/:quoteId（采购方，需要 inquiry:evaluate）：
 * 开标前返回 QUOTE_SEALED（05 §7.1 S-1），开标后金额按 quote.amount 脱敏（S-5）
 */
export interface RoundQuoteDetailDto {
  id: string;
  status: QuoteStatus;
  supplier: { id: string; code: string; nameZh: string; nameEn: string | null };
  invitedAt: string;
  firstViewedAt: string | null;
  respondedAt: string | null;
  lastSubmittedAt: string | null;
  declinedAt: string | null;
  /** 字典 decline_reason */
  declineReasonCode: string | null;
  declineReason: string | null;
  /** 该轮冻结的模板 */
  template: PplResolvedDto;
  currentVersion: QuoteVersionDto | null;
  versions: QuoteVersionSummaryDto[];
}

// ---------- 比价矩阵（M11） ----------

/** 汇总表里议价的概况 */
export interface MatrixNegotiationDto {
  status: NegotiationStatus;
  /** 轮到谁回复；关闭或不能再议价时为 null */
  awaiting: NegotiationParty | null;
  messageCount: number;
}

/** 汇总表的一行（R11-2）：该轮每家受邀供应商一行，按邀请顺序 */
export interface MatrixSupplierDto {
  quoteId: string;
  supplier: { id: string; code: string; nameZh: string; nameEn: string | null };
  /** INVITED 在开标后显示为"未响应"（05 §4） */
  status: QuoteStatus;
  /** 有有效报价（有当前版本且没有拒绝），参与明细比较 */
  quoted: boolean;
  /** 含税合计（2 位小数）；没有有效报价或被脱敏时为 null */
  totalAmount: string | null;
  currency: string | null;
  /** 各行交期（lead_time_days）的最大值 */
  maxLeadTimeDays: number | null;
  versionCount: number;
  currentVersionNo: number | null;
  currentVersionSource: QuoteVersionSource | null;
  lastSubmittedAt: string | null;
  /** 当前版本的变更备注（#7） */
  changeNote: string | null;
  /** 字典 decline_reason */
  declineReasonCode: string | null;
  declineReason: string | null;
  shortlisted: boolean;
  /** 含税合计最低（并列都标；至少两家可比时才标）；金额被脱敏时恒为 false */
  lowestTotal: boolean;
  negotiation: MatrixNegotiationDto | null;
  /** 被脱敏的字段：totalAmount（quote.amount） */
  maskedFields?: string[];
}

/** 明细里一家供应商在一个询价行上的取值（R11-3、R11-4） */
export interface MatrixCellsDto {
  quoteId: string;
  /** 明细列的当前版本取值；被脱敏的金额列为 null */
  values: Record<string, PplValue | null>;
  /** 与该报价单上一版本相比变化的列 → 上一版本的取值（上一版本没填为 null）；第 1 版为空对象；被脱敏的列不出现 */
  changes: Record<string, PplValue | null>;
  /** 本询价行含税单价最低（并列都标；至少两家可比时才标）；被脱敏时恒为 false */
  lowestUnitPrice: boolean;
}

/** 明细：一个询价行，quotes 按汇总表里有效报价的顺序 */
export interface MatrixLineDto {
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
  quotes: MatrixCellsDto[];
}

/**
 * GET /api/inquiries/:id/rounds/:roundNo/matrix（R11-1，需要 inquiry:evaluate）：开过标才可用，否则 QUOTE_SEALED；
 * 金额按 quote.amount 脱敏（S-5）
 */
export interface RoundMatrixDto {
  roundNo: number;
  roundStatus: RoundStatus;
  /** 字典 currency（询价单币种，各家报价同币种） */
  currency: string;
  /** 明细的行（属性）：该轮冻结模板里 inMatrix 的列（按模板顺序）；有议价改过数量时另含 quantity 列 */
  columns: PplResolvedColumn[];
  suppliers: MatrixSupplierDto[];
  lines: MatrixLineDto[];
  /** 每轮最多入围几家 */
  shortlistLimit: number;
  /** 当前用户能否调整入围（computeInquiryActions 的 shortlist，且是当前轮次） */
  canShortlist: boolean;
}
