import { describe, expect, it } from 'vitest';
import { inquiryReportQuerySchema, pointsAdjustSchema, pointsLedgerQuerySchema } from './reports';
import { statsExportQuerySchema, statsProjectsQuerySchema, statsResponseSpeedQuerySchema } from './stats';

describe('统计与报表 schema', () => {
  it('统计：年度可省略（服务端取当年），日期区间 from 不晚于 to、跨度不超过 10 年', () => {
    expect(statsProjectsQuerySchema.parse({})).toEqual({});
    expect(statsProjectsQuerySchema.parse({ year: '2026' }).year).toBe(2026);
    expect(statsProjectsQuerySchema.safeParse({ year: '26' }).success).toBe(false);
    expect(statsResponseSpeedQuerySchema.parse({ from: '2026-01-01', to: '2026-01-01' })).toMatchObject({
      from: '2026-01-01',
      to: '2026-01-01',
    });
    expect(statsResponseSpeedQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(
      false,
    );
    expect(statsResponseSpeedQuerySchema.safeParse({ from: '2016-01-01', to: '2026-12-31' }).success).toBe(
      true,
    );
    expect(statsExportQuerySchema.safeParse({ from: '2015-01-01', to: '2026-12-31' }).success).toBe(false);
    expect(statsResponseSpeedQuerySchema.safeParse({ from: '2026/01/01' }).success).toBe(false);
  });

  it('报表：分页默认值、轮次状态、日期区间', () => {
    expect(inquiryReportQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(inquiryReportQuerySchema.parse({ roundStatus: 'OPENED', inquiryNo: ' RFQ ' })).toMatchObject({
      roundStatus: 'OPENED',
      inquiryNo: 'RFQ',
    });
    expect(inquiryReportQuerySchema.safeParse({ roundStatus: 'OPEN' }).success).toBe(false);
    expect(inquiryReportQuerySchema.safeParse({ from: '2026-03-01', to: '2026-02-01' }).success).toBe(false);
    expect(pointsLedgerQuerySchema.parse({ ruleCode: 'MANUAL' }).ruleCode).toBe('MANUAL');
    expect(pointsLedgerQuerySchema.safeParse({ ruleCode: 'BONUS' }).success).toBe(false);
  });

  it('R15-3 手工调整：分值是非零整数（±1000 以内），备注去空白，空备注由服务端报 POINTS_REMARK_REQUIRED', () => {
    expect(pointsAdjustSchema.parse({ delta: -3, remark: ' 样品不合格 ' })).toEqual({
      delta: -3,
      remark: '样品不合格',
    });
    expect(pointsAdjustSchema.parse({ delta: 5, remark: '  ' }).remark).toBeUndefined();
    expect(pointsAdjustSchema.safeParse({ delta: 0, remark: 'x' }).success).toBe(false);
    expect(pointsAdjustSchema.safeParse({ delta: 1.5, remark: 'x' }).success).toBe(false);
    expect(pointsAdjustSchema.safeParse({ delta: 1001, remark: 'x' }).success).toBe(false);
    expect(pointsAdjustSchema.safeParse({ delta: '3', remark: 'x' }).success).toBe(false);
    expect(pointsAdjustSchema.safeParse({ delta: 3, remark: 'x'.repeat(501) }).success).toBe(false);
  });
});
