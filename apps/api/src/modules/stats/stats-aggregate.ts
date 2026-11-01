import {
  CYCLE_TIME_BUCKETS,
  QuoteStatus,
  RESPONSE_SPEED_BUCKETS,
  type CycleTimeBucket,
  type ResponseSpeedBucket,
  type StatsCycleTimeDto,
  type StatsProjectsMonthDto,
  type StatsWinRateMonthDto,
} from '@quoteflow/shared';
import { appDayStart, inAppTz } from '../../common/time';

// 统计看板的纯函数聚合（M15 §3，R15-1）：服务层查出千级的行，这里按口径分组计数。日期一律按 UTC+8 归属到日 / 月

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** 时刻所属的业务月份 YYYY-MM（UTC 2026-10-31 17:00 是北京时间 11 月 1 日，归入 2026-11） */
export function appMonth(date: Date): string {
  return inAppTz(date).format('YYYY-MM');
}

/** 日期区间（YYYY-MM-DD，含首尾两天，按 UTC+8）对应的时刻范围 [gte, lt) */
export function rangeBounds(from: string, to: string): { gte: Date; lt: Date } {
  return { gte: appDayStart(from).toDate(), lt: appDayStart(to).add(1, 'day').toDate() };
}

/** from 到 to 经过的月份（含首尾所在的月） */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const last = to.slice(0, 7);
  let [year, month] = from.slice(0, 7).split('-').map(Number);
  for (;;) {
    const current = `${year}-${String(month).padStart(2, '0')}`;
    if (current > last) return months;
    months.push(current);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
}

/** 比率；分母为 0 时为 null */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

// ---------- 年询盘项目数与品类（#13、#14） ----------

export interface ProjectsInquiryRow {
  /** 第 1 轮的发布时间 */
  publishedAt: Date;
  projectNo: string;
  /** 第 1 轮询价行分类的顶级祖先（可以重复） */
  topCategoryIds: string[];
}

export interface ProjectsAggregate {
  months: StatsProjectsMonthDto[];
  total: Omit<StatsProjectsMonthDto, 'month'>;
  /** 顶级分类 id → 涉及它的询价单数 */
  categories: Map<string, number>;
}

/** 按第 1 轮发布月份统计询价单数、不同项目号数、顶级分类数；全年的项目数、品类数另外去重 */
export function aggregateProjects(year: number, rows: readonly ProjectsInquiryRow[]): ProjectsAggregate {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const byMonth = new Map(
    months.map((m) => [m, { inquiries: 0, projects: new Set<string>(), tops: new Set<string>() }]),
  );
  const all = { inquiries: 0, projects: new Set<string>(), tops: new Set<string>() };
  const categories = new Map<string, number>();
  for (const row of rows) {
    const bucket = byMonth.get(appMonth(row.publishedAt));
    if (!bucket) continue;
    const tops = new Set(row.topCategoryIds);
    for (const target of [bucket, all]) {
      target.inquiries += 1;
      target.projects.add(row.projectNo);
      for (const id of tops) target.tops.add(id);
    }
    for (const id of tops) categories.set(id, (categories.get(id) ?? 0) + 1);
  }
  const counts = (b: typeof all) => ({
    inquiryCount: b.inquiries,
    projectCount: b.projects.size,
    categoryCount: b.tops.size,
  });
  return {
    months: months.map((month) => ({ month, ...counts(byMonth.get(month)!) })),
    total: counts(all),
    categories,
  };
}

// ---------- 供应商响应速度（#15） ----------

export interface ResponseQuoteRow {
  supplierId: string;
  status: QuoteStatus;
  invitedAt: Date;
  respondedAt: Date | null;
  /** 所属轮次的截止时间 */
  deadline: Date | null;
}

/** 上界（含）→ 桶；超过最后一个上界的是 GT_3D */
const RESPONSE_LIMITS: [number, ResponseSpeedBucket][] = [
  [2 * HOUR_MS, 'LE_2H'],
  [8 * HOUR_MS, 'H2_8'],
  [24 * HOUR_MS, 'H8_24'],
  [3 * DAY_MS, 'D1_3'],
];

/**
 * 一张报价单落在哪个桶：已响应的按 respondedAt − invitedAt（作废的只要响应过照样计入）；没响应的，截止时间已过且没作废
 * 记"未响应"；其余（还没到截止、作废时还没响应）不计入，返回 null
 */
export function responseBucket(quote: ResponseQuoteRow, now: Date): ResponseSpeedBucket | null {
  if (quote.respondedAt) {
    const ms = quote.respondedAt.getTime() - quote.invitedAt.getTime();
    return RESPONSE_LIMITS.find(([limit]) => ms <= limit)?.[1] ?? 'GT_3D';
  }
  if (quote.status === QuoteStatus.VOID) return null;
  return quote.deadline && quote.deadline.getTime() <= now.getTime() ? 'NO_RESPONSE' : null;
}

export interface SupplierResponseStats {
  invitedCount: number;
  respondedCount: number;
  responseRate: number | null;
  avgResponseHours: number | null;
}

export interface ResponseSpeedAggregate {
  total: number;
  buckets: { bucket: ResponseSpeedBucket; count: number }[];
  /** 供应商 id → 统计（只有计入的报价单） */
  suppliers: Map<string, SupplierResponseStats>;
}

export function aggregateResponseSpeed(
  quotes: readonly ResponseQuoteRow[],
  now: Date,
): ResponseSpeedAggregate {
  const counts = new Map<ResponseSpeedBucket, number>(RESPONSE_SPEED_BUCKETS.map((b) => [b, 0]));
  const perSupplier = new Map<string, { invited: number; hours: number[] }>();
  let total = 0;
  for (const quote of quotes) {
    const bucket = responseBucket(quote, now);
    if (!bucket) continue;
    total += 1;
    counts.set(bucket, counts.get(bucket)! + 1);
    const s = perSupplier.get(quote.supplierId) ?? { invited: 0, hours: [] };
    s.invited += 1;
    if (quote.respondedAt) s.hours.push((quote.respondedAt.getTime() - quote.invitedAt.getTime()) / HOUR_MS);
    perSupplier.set(quote.supplierId, s);
  }
  const suppliers = new Map(
    [...perSupplier].map(([id, s]) => [
      id,
      {
        invitedCount: s.invited,
        respondedCount: s.hours.length,
        responseRate: ratio(s.hours.length, s.invited),
        avgResponseHours: average(s.hours),
      },
    ]),
  );
  return {
    total,
    buckets: RESPONSE_SPEED_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket)! })),
    suppliers,
  };
}

// ---------- 中选次数与成功率（#16） ----------

export interface WinRateQuoteRow {
  supplierId: string;
  /** 评标完成的轮次里：WON / LOST / INVITED（未响应）/ DECLINED */
  status: QuoteStatus;
  /** 曾提交过报价（有版本） */
  quoted: boolean;
  /** 所属轮次的评标完成时间 */
  evaluatedAt: Date;
}

export interface SupplierWinStats {
  invitedCount: number;
  quotedCount: number;
  wonCount: number;
  winRate: number | null;
}

export interface WinRateAggregate {
  months: StatsWinRateMonthDto[];
  total: Omit<StatsWinRateMonthDto, 'month'>;
  suppliers: Map<string, SupplierWinStats>;
}

/** 按评标完成月份：中标次数（WON）、参与评标的报价单数（WON + LOST）；每家供应商的受邀、报价、中标数 */
export function aggregateWinRate(
  quotes: readonly WinRateQuoteRow[],
  months: readonly string[],
): WinRateAggregate {
  const byMonth = new Map(months.map((m) => [m, { won: 0, participants: 0 }]));
  const all = { won: 0, participants: 0 };
  const perSupplier = new Map<string, { invited: number; quoted: number; won: number }>();
  for (const quote of quotes) {
    const won = quote.status === QuoteStatus.WON;
    const participated = won || quote.status === QuoteStatus.LOST;
    const month = byMonth.get(appMonth(quote.evaluatedAt));
    for (const target of month ? [month, all] : [all]) {
      if (won) target.won += 1;
      if (participated) target.participants += 1;
    }
    const s = perSupplier.get(quote.supplierId) ?? { invited: 0, quoted: 0, won: 0 };
    s.invited += 1;
    if (quote.quoted) s.quoted += 1;
    if (won) s.won += 1;
    perSupplier.set(quote.supplierId, s);
  }
  const rates = (b: typeof all) => ({
    winCount: b.won,
    participantCount: b.participants,
    successRate: ratio(b.won, b.participants),
  });
  return {
    months: months.map((month) => ({ month, ...rates(byMonth.get(month)!) })),
    total: rates(all),
    suppliers: new Map(
      [...perSupplier].map(([id, s]) => [
        id,
        { invitedCount: s.invited, quotedCount: s.quoted, wonCount: s.won, winRate: ratio(s.won, s.quoted) },
      ]),
    ),
  };
}

// ---------- 询盘周期时效（#17） ----------

/** 周期天数 = completedAt − 第 1 轮 publishedAt，保留 1 位小数（四舍五入） */
export function cycleDays(publishedAt: Date, completedAt: Date): number {
  return Math.round((completedAt.getTime() - publishedAt.getTime()) / (DAY_MS / 10)) / 10;
}

const CYCLE_LIMITS: [number, CycleTimeBucket][] = [
  [3, 'LE_3D'],
  [7, 'D4_7'],
  [14, 'D8_14'],
  [30, 'D15_30'],
];

/** 按保留 1 位小数后的天数分桶，上界含边界：3.0 → ≤3 天，3.1 → 4–7 天 */
export function cycleBucket(days: number): CycleTimeBucket {
  return CYCLE_LIMITS.find(([limit]) => days <= limit)?.[1] ?? 'GT_30D';
}

export interface CycleInquiryRow {
  publishedAt: Date;
  completedAt: Date;
}

export function aggregateCycleTime(
  rows: readonly CycleInquiryRow[],
  months: readonly string[],
): Pick<StatsCycleTimeDto, 'total' | 'avgDays' | 'buckets' | 'months'> {
  const counts = new Map<CycleTimeBucket, number>(CYCLE_TIME_BUCKETS.map((b) => [b, 0]));
  const byMonth = new Map(months.map((m) => [m, [] as number[]]));
  const all: number[] = [];
  for (const row of rows) {
    const days = cycleDays(row.publishedAt, row.completedAt);
    const bucket = cycleBucket(days);
    counts.set(bucket, counts.get(bucket)! + 1);
    all.push(days);
    byMonth.get(appMonth(row.completedAt))?.push(days);
  }
  return {
    total: all.length,
    avgDays: average(all),
    buckets: CYCLE_TIME_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket)! })),
    months: months.map((month) => {
      const days = byMonth.get(month)!;
      return { month, count: days.length, avgDays: average(days) };
    }),
  };
}
