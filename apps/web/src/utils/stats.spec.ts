import type {
  StatsCycleTimeDto,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsWinRateDto,
} from '@quoteflow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import {
  currentAppYear,
  cycleTimeOption,
  formatOneDecimal,
  formatPercent,
  monthLabel,
  projectsOption,
  responseSpeedOption,
  sharePercent,
  winRateOption,
} from './stats';

const t = (key: string, named?: Record<string, unknown>) => i18n.global.t(key, named ?? {});

/** ECharts 配置里某个系列的数据 */
const seriesData = (option: unknown, index = 0) =>
  ((option as { series: { data: unknown[] }[] }).series[index].data as unknown[]).map((d) =>
    typeof d === 'object' && d !== null ? (d as { value: unknown }).value : d,
  );
const axisData = (option: unknown, axis: 'xAxis' | 'yAxis') =>
  (option as Record<string, { data: string[] }>)[axis].data;

describe('统计看板的格式化与图表配置（R15-1 前端负责格式化）', () => {
  beforeEach(() => applyLocale('zh-CN'));

  it('比率、小数、占比；分母为 0 时显示 —', () => {
    expect(formatPercent(2 / 3)).toBe('66.7%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(null)).toBe('—');
    expect(formatOneDecimal(3.00556)).toBe('3.0');
    expect(formatOneDecimal(null)).toBe('—');
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(0, 0)).toBe(0);
  });

  it('当年按北京时间：UTC 2026-12-31 16:00 已是 2027 年', () => {
    expect(currentAppYear(new Date('2026-12-31T15:59:59Z'))).toBe(2026);
    expect(currentAppYear(new Date('2026-12-31T16:00:00Z'))).toBe(2027);
  });

  it('月份标签：同一年显示"1月 / Jan"，跨年显示 2026-01', () => {
    expect(monthLabel('2026-01', t)).toBe('1月');
    expect(monthLabel('2026-11', t, true)).toBe('2026-11');
    applyLocale('en-US');
    expect(monthLabel('2026-03', t)).toBe('Mar');
  });

  it('年询盘项目数与品类：项目数柱状 + 品类数折线（双轴）', () => {
    const data: StatsProjectsDto = {
      year: 2026,
      months: Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, '0')}`,
        inquiryCount: i === 0 ? 3 : 0,
        projectCount: i === 0 ? 2 : 0,
        categoryCount: i === 0 ? 1 : 0,
      })),
      total: { inquiryCount: 3, projectCount: 2, categoryCount: 1 },
      categories: [],
    };
    const option = projectsOption(data, t);
    expect(axisData(option, 'xAxis').slice(0, 2)).toEqual(['1月', '2月']);
    expect(seriesData(option, 0).slice(0, 2)).toEqual([2, 0]);
    expect(seriesData(option, 1).slice(0, 2)).toEqual([1, 0]);
    expect(
      (option.series as { type: string; yAxisIndex?: number }[]).map((s) => [s.type, s.yAxisIndex ?? 0]),
    ).toEqual([
      ['bar', 0],
      ['line', 1],
    ]);
  });

  it('响应速度：各桶的占比（%），未响应灰色', () => {
    const data: StatsResponseSpeedDto = {
      from: '2026-01-01',
      to: '2026-12-31',
      total: 8,
      buckets: [
        { bucket: 'LE_2H', count: 2 },
        { bucket: 'H2_8', count: 3 },
        { bucket: 'H8_24', count: 1 },
        { bucket: 'D1_3', count: 1 },
        { bucket: 'GT_3D', count: 0 },
        { bucket: 'NO_RESPONSE', count: 1 },
      ],
      suppliers: [],
    };
    const option = responseSpeedOption(data, t);
    expect(axisData(option, 'xAxis')).toEqual([
      '≤2小时',
      '2–8小时',
      '8–24小时',
      '1–3天',
      '3天以上',
      '未响应',
    ]);
    expect(seriesData(option)).toEqual([25, 37.5, 12.5, 12.5, 0, 12.5]);
    const colors = (option.series as { data: { itemStyle: { color: string } }[] }[])[0].data.map(
      (d) => d.itemStyle.color,
    );
    expect(new Set(colors.slice(0, 5)).size).toBe(1);
    expect(colors[5]).not.toBe(colors[0]);
  });

  it('中选次数与成功率：跨年时月份写 YYYY-MM，成功率折线是百分数，没有评标的月份为空', () => {
    const data: StatsWinRateDto = {
      from: '2025-12-01',
      to: '2026-01-31',
      months: [
        { month: '2025-12', winCount: 2, participantCount: 3, successRate: 2 / 3 },
        { month: '2026-01', winCount: 0, participantCount: 0, successRate: null },
      ],
      total: { winCount: 2, participantCount: 3, successRate: 2 / 3 },
      suppliers: [],
    };
    const option = winRateOption(data, t);
    expect(axisData(option, 'xAxis')).toEqual(['2025-12', '2026-01']);
    expect(seriesData(option, 0)).toEqual([2, 0]);
    expect(seriesData(option, 1)).toEqual([66.7, null]);
  });

  it('询盘周期时效：横向条形，≤3 天在最上面', () => {
    const data: StatsCycleTimeDto = {
      from: '2026-01-01',
      to: '2026-12-31',
      total: 4,
      avgDays: 6.5,
      buckets: [
        { bucket: 'LE_3D', count: 1 },
        { bucket: 'D4_7', count: 2 },
        { bucket: 'D8_14', count: 1 },
        { bucket: 'D15_30', count: 0 },
        { bucket: 'GT_30D', count: 0 },
      ],
      months: [],
    };
    const option = cycleTimeOption(data, t);
    expect(axisData(option, 'yAxis')).toEqual(['≤3天', '4–7天', '8–14天', '15–30天', '30天以上']);
    expect((option.yAxis as { inverse: boolean }).inverse).toBe(true);
    expect(seriesData(option)).toEqual([25, 50, 25, 0, 0]);
  });
});
