import {
  APP_TZ,
  type StatsCycleTimeDto,
  type StatsProjectsDto,
  type StatsResponseSpeedDto,
  type StatsWinRateDto,
} from '@quoteflow/shared';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

// 统计看板（M15 §3、§7）：接口返回原始数值，这里负责格式化和生成 ECharts 配置（R15-1）。图表形式参考 PPT #13：
// 项目数柱状 + 品类数折线（双轴）、响应速度柱状（占比 %）、中选次数柱状 + 成功率折线、周期时效横向条形（占比 %）

export type StatsChartOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>;

type Translate = (key: string, named?: Record<string, unknown>) => string;

dayjs.extend(utc);
dayjs.extend(timezone);

/** 北京时间的当年（统计默认区间） */
export function currentAppYear(now: Date = new Date()): number {
  return dayjs(now).tz(APP_TZ).year();
}

/** 北京时间的当月 YYYY-MM：之后的月份还没有数据，折线不画 */
export function currentAppMonth(now: Date = new Date()): string {
  return dayjs(now).tz(APP_TZ).format('YYYY-MM');
}

const NAVY = '#1F3A5F';
const TEAL = '#0F766E';
const GREY = '#C0C4CC';
const EMPTY = '—';

/** 比率（0~1）→ 百分比文字，保留 1 位小数；分母为 0（null）时为 — */
export function formatPercent(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? EMPTY : `${(ratio * 100).toFixed(1)}%`;
}

/** 小时、天数保留 1 位小数；没有数据时为 — */
export function formatOneDecimal(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY : value.toFixed(1);
}

/** 占比（百分数，保留 1 位小数），图表用 */
export function sharePercent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

/** 占比文字：12.5%、0.0% */
export function formatShare(count: number, total: number): string {
  return `${sharePercent(count, total).toFixed(1)}%`;
}

/** 月份 YYYY-MM 的标签：区间在同一年时显示"1月 / Jan"，跨年时显示 2026-01 */
export function monthLabel(month: string, t: Translate, crossYear = false): string {
  const [year, m] = month.split('-');
  return crossYear ? `${year}-${m}` : t(`stats.months.${Number(m)}`);
}

const crosses = (months: { month: string }[]) =>
  months.length > 0 && months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);

/** 坐标轴提示：第一行是横轴标签，下面每行"系列：值" */
function axisTooltip(t: Translate, rows: (index: number) => [string, string][]) {
  return (params: unknown): string => {
    const list = (Array.isArray(params) ? params : [params]) as {
      dataIndex: number;
      axisValueLabel?: string;
    }[];
    const index = list[0]?.dataIndex ?? 0;
    const lines = rows(index).map(([label, value]) => `${t('stats.tooltipLabel', { label })}<b>${value}</b>`);
    return [list[0]?.axisValueLabel ?? '', ...lines].join('<br/>');
  };
}

const grid = { left: 12, right: 12, top: 44, bottom: 8, containLabel: true };
/** 纵轴名称写在轴的上方，左轴向右展开、右轴向左展开，不会被画布边缘裁掉 */
const LEFT_NAME = { align: 'left' } as const;
const RIGHT_NAME = { align: 'right' } as const;
/** 柱子上的占比，统一 1 位小数 */
const percentLabel = (params: unknown) => `${Number((params as { value: number }).value).toFixed(1)}%`;

/** #13、#14：项目数柱状 + 品类数折线，双纵轴；提示里另有询价单数。currentMonth 之后的月份不画折线 */
export function projectsOption(
  data: StatsProjectsDto,
  t: Translate,
  currentMonth?: string,
): StatsChartOption {
  const months = data.months;
  const projectName = t('stats.projects.projectCount');
  const categoryName = t('stats.projects.categoryCount');
  return {
    color: [NAVY, TEAL],
    grid,
    legend: { top: 0, data: [projectName, categoryName] },
    tooltip: {
      trigger: 'axis',
      formatter: axisTooltip(t, (i) => [
        [t('stats.projects.inquiryCount'), String(months[i].inquiryCount)],
        [projectName, String(months[i].projectCount)],
        [categoryName, String(months[i].categoryCount)],
      ]),
    },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m.month, t)) },
    yAxis: [
      { type: 'value', name: t('stats.projects.projectAxis'), nameTextStyle: LEFT_NAME, minInterval: 1 },
      {
        type: 'value',
        name: t('stats.projects.categoryAxis'),
        nameTextStyle: RIGHT_NAME,
        minInterval: 1,
        splitLine: { show: false },
      },
    ],
    series: [
      { name: projectName, type: 'bar', barMaxWidth: 22, data: months.map((m) => m.projectCount) },
      {
        name: categoryName,
        type: 'line',
        yAxisIndex: 1,
        symbol: 'circle',
        symbolSize: 7,
        data: months.map((m) => (currentMonth && m.month > currentMonth ? null : m.categoryCount)),
      },
    ],
  };
}

/** #15：各响应时长的占比（%），未响应用灰色 */
export function responseSpeedOption(data: StatsResponseSpeedDto, t: Translate): StatsChartOption {
  const share = t('stats.share');
  return {
    color: [TEAL],
    grid,
    legend: { top: 0, data: [share] },
    tooltip: {
      trigger: 'axis',
      formatter: axisTooltip(t, (i) => [
        [t('stats.response.count'), String(data.buckets[i].count)],
        [share, `${sharePercent(data.buckets[i].count, data.total)}%`],
      ]),
    },
    xAxis: {
      type: 'category',
      // 六个区间的标签都显示，英文较长时折行
      axisLabel: { interval: 0, width: 72, overflow: 'break' },
      data: data.buckets.map((b) => t(`stats.response.buckets.${b.bucket}`)),
    },
    yAxis: {
      type: 'value',
      name: t('stats.response.axis'),
      nameTextStyle: LEFT_NAME,
      max: 100,
      axisLabel: { formatter: '{value}%' },
    },
    series: [
      {
        name: share,
        type: 'bar',
        barMaxWidth: 44,
        label: { show: true, position: 'top', formatter: percentLabel },
        data: data.buckets.map((b) => ({
          value: sharePercent(b.count, data.total),
          itemStyle: { color: b.bucket === 'NO_RESPONSE' ? GREY : TEAL },
        })),
      },
    ],
  };
}

/** #16：中标次数柱状 + 成功率折线（%），双纵轴；提示里另有参与评标的报价单数 */
export function winRateOption(data: StatsWinRateDto, t: Translate): StatsChartOption {
  const months = data.months;
  const crossYear = crosses(months);
  const winName = t('stats.winRate.winCount');
  const rateName = t('stats.winRate.successRate');
  return {
    color: [NAVY, TEAL],
    grid,
    legend: { top: 0, data: [winName, rateName] },
    tooltip: {
      trigger: 'axis',
      formatter: axisTooltip(t, (i) => [
        [winName, String(months[i].winCount)],
        [t('stats.winRate.participantCount'), String(months[i].participantCount)],
        [rateName, formatPercent(months[i].successRate)],
      ]),
    },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m.month, t, crossYear)) },
    yAxis: [
      { type: 'value', name: t('stats.winRate.winAxis'), nameTextStyle: LEFT_NAME, minInterval: 1 },
      {
        type: 'value',
        name: t('stats.winRate.rateAxis'),
        nameTextStyle: RIGHT_NAME,
        max: 100,
        splitLine: { show: false },
        axisLabel: { formatter: '{value}%' },
      },
    ],
    series: [
      { name: winName, type: 'bar', barMaxWidth: 22, data: months.map((m) => m.winCount) },
      {
        name: rateName,
        type: 'line',
        yAxisIndex: 1,
        symbol: 'circle',
        symbolSize: 7,
        connectNulls: true,
        data: months.map((m) => (m.successRate === null ? null : Math.round(m.successRate * 1000) / 10)),
      },
    ],
  };
}

/** #17：各周期区间的占比（%），横向条形，≤3 天在最上面 */
export function cycleTimeOption(data: StatsCycleTimeDto, t: Translate): StatsChartOption {
  const share = t('stats.share');
  return {
    color: [TEAL],
    grid: { ...grid, right: 40 },
    legend: { top: 0, data: [share] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: axisTooltip(t, (i) => [
        [t('stats.cycle.count'), String(data.buckets[i].count)],
        [share, `${sharePercent(data.buckets[i].count, data.total)}%`],
      ]),
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.buckets.map((b) => t(`stats.cycle.buckets.${b.bucket}`)),
    },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      {
        name: share,
        type: 'bar',
        barMaxWidth: 18,
        label: { show: true, position: 'right', formatter: percentLabel },
        data: data.buckets.map((b) => sharePercent(b.count, data.total)),
      },
    ],
  };
}
