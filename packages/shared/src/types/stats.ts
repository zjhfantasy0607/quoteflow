import type { CycleTimeBucket, ResponseSpeedBucket } from '../schemas/stats';

// 统计看板（M15 §3）：接口返回原始数值（次数、比率 0~1、小时、天），前端负责格式化（R15-1）。
// 月份 month 是 YYYY-MM，日期按 UTC+8 归属；比率的分母为 0 时为 null

export interface StatsCategoryDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
}

export interface StatsSupplierDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
  /** 字典 supplier_category */
  categoryCode: string;
}

/** 某月第 1 轮发布的询价单 */
export interface StatsProjectsMonthDto {
  month: string;
  inquiryCount: number;
  /** 不同项目号的个数 */
  projectCount: number;
  /** 询价行分类的顶级祖先有几种 */
  categoryCount: number;
}

/** GET /api/stats/projects（#13、#14） */
export interface StatsProjectsDto {
  year: number;
  /** 1~12 月 */
  months: StatsProjectsMonthDto[];
  /** 全年（项目数、品类数是全年去重，不是各月相加） */
  total: Omit<StatsProjectsMonthDto, 'month'>;
  /** 全年按顶级材料分类的询价单数：一张询价单涉及几个顶级分类就各计一次；按询价单数倒序 */
  categories: { category: StatsCategoryDto; inquiryCount: number }[];
}

/** GET /api/stats/response-speed（#15）：以报价单为单位，邀请时间落在区间内 */
export interface StatsResponseSpeedDto {
  /** 实际使用的区间（YYYY-MM-DD） */
  from: string;
  to: string;
  /** 计入统计的报价单数 = 各桶之和（已响应 + 截止时未响应；还没截止又没响应的、作废时未响应的不计） */
  total: number;
  buckets: { bucket: ResponseSpeedBucket; count: number }[];
  /** 每家供应商，按编码 */
  suppliers: {
    supplier: StatsSupplierDto;
    invitedCount: number;
    respondedCount: number;
    /** respondedCount ÷ invitedCount */
    responseRate: number | null;
    /** 已响应的平均响应时长（小时） */
    avgResponseHours: number | null;
  }[];
}

/** 中选次数与成功率的一个月 */
export interface StatsWinRateMonthDto {
  month: string;
  /** 中标次数（不筛选供应商时 = 评标完成的轮次数） */
  winCount: number;
  /** 参与评标的报价单数（WON + LOST） */
  participantCount: number;
  /** winCount ÷ participantCount */
  successRate: number | null;
}

/** GET /api/stats/win-rate（#16）：以评标完成的轮次为单位，评标完成时间落在区间内 */
export interface StatsWinRateDto {
  from: string;
  to: string;
  months: StatsWinRateMonthDto[];
  total: Omit<StatsWinRateMonthDto, 'month'>;
  /** 每家供应商，按编码 */
  suppliers: {
    supplier: StatsSupplierDto;
    invitedCount: number;
    /** 曾提交过报价的报价单数 */
    quotedCount: number;
    wonCount: number;
    /** wonCount ÷ quotedCount */
    winRate: number | null;
  }[];
}

/** GET /api/stats/cycle-time（#17）：以完成的询价单为单位，完成时间落在区间内 */
export interface StatsCycleTimeDto {
  from: string;
  to: string;
  /** 完成的询价单数 = 各桶之和 */
  total: number;
  /** 平均周期（天）：每张单的周期先保留 1 位小数再平均，不再取整 */
  avgDays: number | null;
  buckets: { bucket: CycleTimeBucket; count: number }[];
  months: { month: string; count: number; avgDays: number | null }[];
}
