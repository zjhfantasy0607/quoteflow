import type { EnableStatus, PointsRuleCode, PointsSource, QuoteStatus, RoundStatus } from '../enums';
import type { PplColumn } from '../ppl/definition';
import type { PplValue } from '../ppl/values';
import type { Paginated } from '../schemas/common';
import type { UserBriefDto } from './inquiries';

// 报表（M15 §4）与积分（R15-3、R15-4）。报价金额经过 SealService（开标前密封）并按 quote.amount 脱敏，
// 被脱敏的值为 null 并记在 maskedFields；密封的行 sealed = true

export interface ReportSupplierDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
}

/** GET /api/reports/inquiries 的一行：一个已发布的轮次 */
export interface InquiryReportRowDto {
  roundId: string;
  inquiry: { id: string; formalNo: string; title: string; projectNo: string };
  roundNo: number;
  roundStatus: RoundStatus;
  materialCategory: { id: string; code: string; nameZh: string; nameEn: string };
  /** 字典 currency */
  currency: string;
  /** 受邀家数 = 本轮的报价单数 */
  invitedCount: number;
  /** 有效报价数：提交过且现在没有拒绝 */
  quotedCount: number;
  /** 有效报价当前版本的含税合计（2 位小数）；没有有效报价、密封或被脱敏时为 null */
  minTotal: string | null;
  maxTotal: string | null;
  avgTotal: string | null;
  /** 开标前密封（S-1、S-4）：金额列显示 🔒 */
  sealed: boolean;
  /** 中标供应商（评标完成的轮次） */
  winner: ReportSupplierDto | null;
  owner: UserBriefDto;
  publishedAt: string;
  /** 被脱敏的字段：minTotal、maxTotal、avgTotal */
  maskedFields?: string[];
}

/** GET /api/reports/logistics 的一行：开过标的轮次里一家供应商当前版本的一个询价行（A-09） */
export interface LogisticsReportRowDto {
  /** <quoteId>:<lineId> */
  id: string;
  quoteId: string;
  inquiry: { id: string; formalNo: string; title: string };
  roundNo: number;
  roundStatus: RoundStatus;
  supplier: ReportSupplierDto;
  versionNo: number;
  lineNo: number;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  /** 字典 currency（运费的币种） */
  currency: string;
  /** columns 里各列的取值；被脱敏的金额列（运费）为 null */
  values: Record<string, PplValue | null>;
  /** 被脱敏的列 key */
  maskedFields?: string[];
}

export interface LogisticsReportDto extends Paginated<LogisticsReportRowDto> {
  /** PPL 里 logistics: true 的列 + 量产交期，按主模板顺序 */
  columns: PplColumn[];
}

/** GET /api/reports/points-summary 的一行：一家供应商 */
export interface PointsSummaryRowDto {
  supplier: ReportSupplierDto & { categoryCode: string; status: EnableStatus };
  /** 累计积分（全部记录） */
  balance: number;
  /** 区间内积分（没给区间时等于累计积分） */
  periodPoints: number;
  /** 区间内按规则分项 */
  byRule: Record<PointsRuleCode, number>;
  /** 最近一条积分记录的时间 */
  lastChangedAt: string | null;
}

/** 积分记录（报表流水、供应商详情"积分"页签） */
export interface PointsLedgerItemDto {
  id: string;
  createdAt: string;
  supplier: ReportSupplierDto;
  ruleCode: PointsRuleCode;
  delta: number;
  source: PointsSource;
  /** 关联的询价单（自动积分） */
  inquiry: { id: string; formalNo: string | null } | null;
  roundNo: number | null;
  remark: string | null;
  /** 手工调整的操作人；自动积分为 null */
  createdBy: UserBriefDto | null;
}

/** GET /api/suppliers/:id/points：积分记录 + 累计积分 */
export interface SupplierPointsDto extends Paginated<PointsLedgerItemDto> {
  balance: number;
}

/**
 * GET /api/reports/filter-options：统计看板与报表的筛选下拉（有 stats:view 或 report:view 即可）。
 * 负责人 = 数据权限内有已发布轮次的询价单的负责人；供应商 = 全部供应商（含停用），按编码
 */
export interface ReportFilterOptionsDto {
  owners: UserBriefDto[];
  suppliers: (ReportSupplierDto & { categoryCode: string; status: EnableStatus })[];
}

/** GET /api/suppliers/:id/quotes 的一项（R15-4）：该供应商参与过的报价单 */
export interface SupplierQuoteItemDto {
  id: string;
  inquiry: { id: string; formalNo: string; title: string };
  roundNo: number;
  roundStatus: RoundStatus;
  status: QuoteStatus;
  invitedAt: string;
  respondedAt: string | null;
  lastSubmittedAt: string | null;
  /** 当前版本的含税合计（提交过且没有拒绝）；没有、密封或被脱敏时为 null */
  totalAmount: string | null;
  currency: string;
  /** 开标前密封 */
  sealed: boolean;
  /** 被脱敏的字段：totalAmount */
  maskedFields?: string[];
}
