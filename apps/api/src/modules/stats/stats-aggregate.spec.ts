import type { QuoteStatus } from '@quoteflow/shared';
import {
  aggregateCycleTime,
  aggregateProjects,
  aggregateResponseSpeed,
  aggregateWinRate,
  appMonth,
  cycleBucket,
  cycleDays,
  monthsBetween,
  rangeBounds,
  responseBucket,
  type ResponseQuoteRow,
} from './stats-aggregate';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const utc = (iso: string) => new Date(iso);

describe('M15 统计口径（纯函数）', () => {
  it('R15-1 UTC+8 归月：UTC 2026-10-31 17:00 归入 11 月，15:59:59.999 仍是 10 月', () => {
    expect(appMonth(utc('2026-10-31T17:00:00.000Z'))).toBe('2026-11');
    expect(appMonth(utc('2026-10-31T16:00:00.000Z'))).toBe('2026-11');
    expect(appMonth(utc('2026-10-31T15:59:59.999Z'))).toBe('2026-10');
  });

  it('日期区间按 UTC+8 解释，含首尾两天；按月展开含首尾所在的月、可跨年', () => {
    expect(rangeBounds('2026-01-01', '2026-01-31')).toEqual({
      gte: utc('2025-12-31T16:00:00.000Z'),
      lt: utc('2026-01-31T16:00:00.000Z'),
    });
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-03-01', '2026-03-31')).toEqual(['2026-03']);
  });

  it('R15-1 年询盘项目数与品类：按第 1 轮发布月份计询价单数、不同项目号、不同顶级分类；全年另外去重', () => {
    const result = aggregateProjects(2026, [
      { publishedAt: utc('2026-01-05T02:00:00Z'), projectNo: 'P1', topCategoryIds: ['LED', 'LED'] },
      { publishedAt: utc('2026-01-20T02:00:00Z'), projectNo: 'P1', topCategoryIds: ['PER'] },
      { publishedAt: utc('2026-01-25T02:00:00Z'), projectNo: 'P2', topCategoryIds: ['LED', 'PER'] },
      // 北京时间 2026-03-01 00:30，归入 3 月
      { publishedAt: utc('2026-02-28T16:30:00Z'), projectNo: 'P1', topCategoryIds: ['PER'] },
      // 北京时间 2026-01-01 00:00 属于 2026 年；前一刻属于 2025 年，不计
      { publishedAt: utc('2025-12-31T16:00:00Z'), projectNo: 'P3', topCategoryIds: ['LED'] },
      { publishedAt: utc('2025-12-31T15:59:59Z'), projectNo: 'P9', topCategoryIds: ['LED'] },
    ]);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toEqual({
      month: '2026-01',
      inquiryCount: 4,
      projectCount: 3,
      categoryCount: 2,
    });
    expect(result.months[1]).toEqual({
      month: '2026-02',
      inquiryCount: 0,
      projectCount: 0,
      categoryCount: 0,
    });
    expect(result.months[2]).toEqual({
      month: '2026-03',
      inquiryCount: 1,
      projectCount: 1,
      categoryCount: 1,
    });
    expect(result.total).toEqual({ inquiryCount: 5, projectCount: 3, categoryCount: 2 });
    // 一张单涉及两个顶级分类就各计一次
    expect(Object.fromEntries(result.categories)).toEqual({ LED: 3, PER: 3 });
  });

  it('R15-1 响应速度分桶：上界含边界（恰好 2 小时 → ≤2 小时、恰好 3 天 → 1–3 天）', () => {
    const invitedAt = utc('2026-05-01T00:00:00Z');
    const now = utc('2026-06-01T00:00:00Z');
    const bucket = (ms: number) =>
      responseBucket(
        {
          supplierId: 's',
          status: 'SUBMITTED',
          invitedAt,
          respondedAt: new Date(invitedAt.getTime() + ms),
          deadline: now,
        },
        now,
      );
    expect(bucket(0)).toBe('LE_2H');
    expect(bucket(2 * HOUR)).toBe('LE_2H');
    expect(bucket(2 * HOUR + 1)).toBe('H2_8');
    expect(bucket(8 * HOUR)).toBe('H2_8');
    expect(bucket(8 * HOUR + 1)).toBe('H8_24');
    expect(bucket(24 * HOUR)).toBe('H8_24');
    expect(bucket(24 * HOUR + 1)).toBe('D1_3');
    expect(bucket(3 * DAY)).toBe('D1_3');
    expect(bucket(3 * DAY + 1)).toBe('GT_3D');
  });

  it('R15-1 未响应：截止时仍未响应计"未响应"；还没截止的、作废时还没响应的不计；作废前响应过的照样计入', () => {
    const invitedAt = utc('2026-05-01T00:00:00Z');
    const deadline = utc('2026-05-05T00:00:00Z');
    const quote = (status: QuoteStatus, respondedAt: Date | null): ResponseQuoteRow => ({
      supplierId: 's',
      status,
      invitedAt,
      respondedAt,
      deadline,
    });
    expect(responseBucket(quote('INVITED', null), deadline)).toBe('NO_RESPONSE');
    expect(responseBucket(quote('INVITED', null), new Date(deadline.getTime() - 1))).toBeNull();
    expect(responseBucket(quote('VOID', null), deadline)).toBeNull();
    expect(responseBucket(quote('VOID', new Date(invitedAt.getTime() + HOUR)), deadline)).toBe('LE_2H');
    // 拒绝也算响应
    expect(responseBucket(quote('DECLINED', new Date(invitedAt.getTime() + 10 * HOUR)), deadline)).toBe(
      'H8_24',
    );
  });

  it('R15-1 响应速度汇总：各桶计数、每家的邀请数、响应数、响应率、平均响应时长（小时）', () => {
    const invitedAt = utc('2026-05-01T00:00:00Z');
    const deadline = utc('2026-05-08T00:00:00Z');
    const now = utc('2026-05-09T00:00:00Z');
    const at = (
      hours: number | null,
      supplierId: string,
      status: QuoteStatus = 'SUBMITTED',
    ): ResponseQuoteRow => ({
      supplierId,
      status,
      invitedAt,
      respondedAt: hours === null ? null : new Date(invitedAt.getTime() + hours * HOUR),
      deadline,
    });
    const result = aggregateResponseSpeed(
      [
        at(1, 'a'),
        at(5, 'a'),
        at(null, 'a', 'INVITED'),
        at(30, 'b'),
        at(100, 'b', 'DECLINED'),
        at(null, 'b', 'VOID'),
      ],
      now,
    );
    expect(result.total).toBe(5);
    expect(result.buckets).toEqual([
      { bucket: 'LE_2H', count: 1 },
      { bucket: 'H2_8', count: 1 },
      { bucket: 'H8_24', count: 0 },
      { bucket: 'D1_3', count: 1 },
      { bucket: 'GT_3D', count: 1 },
      { bucket: 'NO_RESPONSE', count: 1 },
    ]);
    expect(result.suppliers.get('a')).toEqual({
      invitedCount: 3,
      respondedCount: 2,
      responseRate: 2 / 3,
      avgResponseHours: 3,
    });
    expect(result.suppliers.get('b')).toEqual({
      invitedCount: 2,
      respondedCount: 2,
      responseRate: 1,
      avgResponseHours: 65,
    });
  });

  it('R15-1 中选次数与成功率：按评标完成月份计中标数 ÷（中标 + 未中标）；每家的受邀、报价、中标数与中标率', () => {
    const months = ['2026-03', '2026-04'];
    const result = aggregateWinRate(
      [
        { supplierId: 'a', status: 'WON', quoted: true, evaluatedAt: utc('2026-03-10T02:00:00Z') },
        { supplierId: 'b', status: 'LOST', quoted: true, evaluatedAt: utc('2026-03-10T02:00:00Z') },
        { supplierId: 'c', status: 'INVITED', quoted: false, evaluatedAt: utc('2026-03-10T02:00:00Z') },
        // 北京时间 4 月 1 日
        { supplierId: 'b', status: 'WON', quoted: true, evaluatedAt: utc('2026-03-31T16:00:00Z') },
        { supplierId: 'a', status: 'LOST', quoted: true, evaluatedAt: utc('2026-03-31T16:00:00Z') },
        // 提交过又拒绝：算报过价，不参与评标
        { supplierId: 'c', status: 'DECLINED', quoted: true, evaluatedAt: utc('2026-03-31T16:00:00Z') },
      ],
      months,
    );
    expect(result.months).toEqual([
      { month: '2026-03', winCount: 1, participantCount: 2, successRate: 0.5 },
      { month: '2026-04', winCount: 1, participantCount: 2, successRate: 0.5 },
    ]);
    expect(result.total).toEqual({ winCount: 2, participantCount: 4, successRate: 0.5 });
    expect(result.suppliers.get('a')).toEqual({ invitedCount: 2, quotedCount: 2, wonCount: 1, winRate: 0.5 });
    expect(result.suppliers.get('c')).toEqual({ invitedCount: 2, quotedCount: 1, wonCount: 0, winRate: 0 });
    expect(aggregateWinRate([], months).total).toEqual({
      winCount: 0,
      participantCount: 0,
      successRate: null,
    });
  });

  it('R15-1 询盘周期：天数保留 1 位小数（四舍五入），按它分桶，恰好 3 天归入 ≤3 天', () => {
    const start = utc('2026-05-01T00:00:00Z');
    const days = (ms: number) => cycleDays(start, new Date(start.getTime() + ms));
    expect(days(3 * DAY)).toBe(3);
    // 3 天 + 1 小时 = 3.04 天 → 3.0
    expect(days(3 * DAY + HOUR)).toBe(3);
    // 3.05 天 → 3.1（四舍五入）
    expect(days(3 * DAY + 1.2 * HOUR)).toBe(3.1);
    expect(cycleBucket(3)).toBe('LE_3D');
    expect(cycleBucket(3.1)).toBe('D4_7');
    expect(cycleBucket(7)).toBe('D4_7');
    expect(cycleBucket(7.1)).toBe('D8_14');
    expect(cycleBucket(14)).toBe('D8_14');
    expect(cycleBucket(30)).toBe('D15_30');
    expect(cycleBucket(30.1)).toBe('GT_30D');
  });

  it('R15-1 询盘周期汇总：各桶计数、平均周期、按完成月份的平均周期', () => {
    const published = utc('2026-02-01T00:00:00Z');
    const done = (iso: string) => ({ publishedAt: published, completedAt: utc(iso) });
    const result = aggregateCycleTime(
      [
        done('2026-02-03T12:00:00Z'), // 2.5 天，2 月
        done('2026-02-06T00:00:00Z'), // 5 天，2 月
        done('2026-03-03T00:00:00Z'), // 30 天，3 月
        done('2026-03-31T16:00:00Z'), // 58.7 天，北京时间 4 月 1 日
      ],
      ['2026-02', '2026-03', '2026-04'],
    );
    expect(result.total).toBe(4);
    expect(result.avgDays).toBeCloseTo((2.5 + 5 + 30 + 58.7) / 4, 10);
    expect(result.buckets).toEqual([
      { bucket: 'LE_3D', count: 1 },
      { bucket: 'D4_7', count: 1 },
      { bucket: 'D8_14', count: 0 },
      { bucket: 'D15_30', count: 1 },
      { bucket: 'GT_30D', count: 1 },
    ]);
    expect(result.months).toEqual([
      { month: '2026-02', count: 2, avgDays: 3.75 },
      { month: '2026-03', count: 1, avgDays: 30 },
      { month: '2026-04', count: 1, avgDays: 58.7 },
    ]);
  });
});
