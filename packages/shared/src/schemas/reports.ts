import { z } from 'zod';
import { POINTS_RULE_CODES, RoundStatus } from '../enums';
import { dateQueryParam, idSchema, optionalText, pageQuerySchema } from './common';
import { supplierCategoryCodeParam, withDateRange } from './stats';

// ---------- 报表（M15 §4）与积分（R15-3、R15-4） ----------

/** 四张报表，导出路径 GET /api/reports/:type/export */
export const REPORT_TYPES = ['inquiries', 'logistics', 'points-summary', 'points-ledger'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** R15-2：报表导出当前筛选条件下的全部行，最多 10000 行 */
export const REPORT_EXPORT_LIMIT = 10000;

/**
 * 询报价单统计、物流报价明细共用的筛选：询价号（部分匹配）、轮次状态、发布日期区间（按 UTC+8，含当天）、
 * 供应商（询报价单统计 = 参与过该轮；物流明细 = 该供应商的行）、负责人、材料类别（含下级）。导出用同一个 schema，忽略分页
 */
const quoteReportFilters = {
  inquiryNo: optionalText(50),
  roundStatus: z.enum(RoundStatus).optional(),
  from: dateQueryParam,
  to: dateQueryParam,
  supplierId: idSchema.optional(),
  ownerId: idSchema.optional(),
  materialCategoryId: idSchema.optional(),
};

/** GET /api/reports/inquiries：一行是一个已发布的轮次 */
export const inquiryReportQuerySchema = withDateRange(pageQuerySchema.extend(quoteReportFilters));
export type InquiryReportQuery = z.infer<typeof inquiryReportQuerySchema>;
export type InquiryReportParams = z.input<typeof inquiryReportQuerySchema>;

/** GET /api/reports/logistics：一行是开过标的轮次里一家供应商当前版本的一个询价行（A-09） */
export const logisticsReportQuerySchema = withDateRange(pageQuerySchema.extend(quoteReportFilters));
export type LogisticsReportQuery = z.infer<typeof logisticsReportQuerySchema>;
export type LogisticsReportParams = z.input<typeof logisticsReportQuerySchema>;

/** GET /api/reports/points-summary：一行是一家供应商；关键字匹配编码与中英文名称，日期区间决定"区间内积分"与分项 */
export const pointsSummaryQuerySchema = withDateRange(
  pageQuerySchema.extend({
    keyword: optionalText(100),
    supplierCategoryCode: supplierCategoryCodeParam,
    from: dateQueryParam,
    to: dateQueryParam,
  }),
);
export type PointsSummaryQuery = z.infer<typeof pointsSummaryQuerySchema>;
export type PointsSummaryParams = z.input<typeof pointsSummaryQuerySchema>;

/** GET /api/reports/points-ledger：一行是一条积分记录 */
export const pointsLedgerQuerySchema = withDateRange(
  pageQuerySchema.extend({
    supplierId: idSchema.optional(),
    ruleCode: z.enum(POINTS_RULE_CODES).optional(),
    from: dateQueryParam,
    to: dateQueryParam,
  }),
);
export type PointsLedgerQuery = z.infer<typeof pointsLedgerQuerySchema>;
export type PointsLedgerParams = z.input<typeof pointsLedgerQuerySchema>;

/** 手工调整一次最多加减 1000 分 */
export const POINTS_ADJUST_MAX = 1000;

/**
 * POST /api/suppliers/:id/points-adjust（R15-3，points:adjust）：分值是非零整数；备注必填，
 * 没填由服务端返回 POINTS_REMARK_REQUIRED
 */
export const pointsAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-POINTS_ADJUST_MAX)
    .max(POINTS_ADJUST_MAX)
    .refine((v) => v !== 0, { message: 'delta must not be 0' }),
  remark: optionalText(500),
});
export type PointsAdjustInput = z.infer<typeof pointsAdjustSchema>;
export type PointsAdjustParams = z.input<typeof pointsAdjustSchema>;
