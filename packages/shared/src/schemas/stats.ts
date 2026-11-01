import { z } from 'zod';
import { dateQueryParam, idSchema } from './common';

// ---------- 统计看板（M15 §3、§6） ----------

/** 日期区间最多跨 10 年（统计按月展开） */
export const STATS_MAX_RANGE_YEARS = 10;

/**
 * 供应商响应速度的分布桶（#15）：响应时长 = respondedAt − invitedAt，上界含边界（恰好 2 小时归入 ≤2 小时）；
 * NO_RESPONSE = 截止时仍未响应
 */
export const RESPONSE_SPEED_BUCKETS = ['LE_2H', 'H2_8', 'H8_24', 'D1_3', 'GT_3D', 'NO_RESPONSE'] as const;
export type ResponseSpeedBucket = (typeof RESPONSE_SPEED_BUCKETS)[number];

/** 询盘周期时效的分布桶（#17）：按保留 1 位小数后的周期天数，上界含边界（恰好 3 天归入 ≤3 天） */
export const CYCLE_TIME_BUCKETS = ['LE_3D', 'D4_7', 'D8_14', 'D15_30', 'GT_30D'] as const;
export type CycleTimeBucket = (typeof CYCLE_TIME_BUCKETS)[number];

/**
 * 日期区间 from、to（YYYY-MM-DD，含当天，按 UTC+8）：from 不晚于 to、跨度不超过 10 年。
 * 两个都是 YYYY-MM-DD，字符串比较就是日期比较
 */
export function withDateRange<T extends z.ZodType<{ from?: string; to?: string }>>(schema: T): T {
  return schema
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      message: 'from must not be later than to',
      path: ['to'],
    })
    .refine(
      (q) =>
        !q.from || !q.to || Number(q.to.slice(0, 4)) - Number(q.from.slice(0, 4)) <= STATS_MAX_RANGE_YEARS,
      { message: `range must not exceed ${STATS_MAX_RANGE_YEARS} years`, path: ['to'] },
    );
}

/** 字典 supplier_category 的编码 */
export const supplierCategoryCodeParam = z.string().trim().min(1).max(50).optional();
const year = z.coerce.number().int().min(2000).max(2100).optional();

/** GET /api/stats/projects：年度（省略为当年，按 UTC+8）、材料分类（含下级） */
export const statsProjectsQuerySchema = z.object({
  year,
  materialCategoryId: idSchema.optional(),
});
export type StatsProjectsQuery = z.infer<typeof statsProjectsQuerySchema>;

/** GET /api/stats/response-speed：邀请日期区间（省略为当年）、供应商分类、材料分类（含下级） */
export const statsResponseSpeedQuerySchema = withDateRange(
  z.object({
    from: dateQueryParam,
    to: dateQueryParam,
    supplierCategoryCode: supplierCategoryCodeParam,
    materialCategoryId: idSchema.optional(),
  }),
);
export type StatsResponseSpeedQuery = z.infer<typeof statsResponseSpeedQuerySchema>;

/** GET /api/stats/win-rate：评标完成日期区间（省略为当年）、供应商、供应商分类 */
export const statsWinRateQuerySchema = withDateRange(
  z.object({
    from: dateQueryParam,
    to: dateQueryParam,
    supplierId: idSchema.optional(),
    supplierCategoryCode: supplierCategoryCodeParam,
  }),
);
export type StatsWinRateQuery = z.infer<typeof statsWinRateQuerySchema>;

/** GET /api/stats/cycle-time：询盘完成日期区间（省略为当年）、材料分类（含下级） */
export const statsCycleTimeQuerySchema = withDateRange(
  z.object({
    from: dateQueryParam,
    to: dateQueryParam,
    materialCategoryId: idSchema.optional(),
  }),
);
export type StatsCycleTimeQuery = z.infer<typeof statsCycleTimeQuerySchema>;

/** GET /api/stats/export（R15-2）：四张图的筛选合在一起，每张图只用自己的那几项 */
export const statsExportQuerySchema = withDateRange(
  z.object({
    year,
    from: dateQueryParam,
    to: dateQueryParam,
    materialCategoryId: idSchema.optional(),
    supplierId: idSchema.optional(),
    supplierCategoryCode: supplierCategoryCodeParam,
  }),
);
export type StatsExportQuery = z.infer<typeof statsExportQuerySchema>;
export type StatsExportParams = z.input<typeof statsExportQuerySchema>;
