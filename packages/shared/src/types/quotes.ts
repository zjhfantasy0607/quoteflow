import type { QuoteStatus, QuoteVersionSource } from '../enums';
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
