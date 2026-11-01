import type { RoundStatus } from '@quoteflow/shared';

/** 询报价单统计、物流报价明细共用的筛选（M15 §4）：询价号、状态、发布日期、供应商、负责人、材料类别 */
export interface QuoteReportFilter {
  inquiryNo: string;
  roundStatus: RoundStatus | '';
  range: [string, string] | null;
  supplierId: string;
  ownerId: string;
  materialCategoryId: string;
}

export const emptyQuoteReportFilter = (): QuoteReportFilter => ({
  inquiryNo: '',
  roundStatus: '',
  range: null,
  supplierId: '',
  ownerId: '',
  materialCategoryId: '',
});

/** 接口参数：空的不传 */
export function quoteReportParams(f: QuoteReportFilter) {
  return {
    inquiryNo: f.inquiryNo || undefined,
    roundStatus: f.roundStatus || undefined,
    from: f.range?.[0],
    to: f.range?.[1],
    supplierId: f.supplierId || undefined,
    ownerId: f.ownerId || undefined,
    materialCategoryId: f.materialCategoryId || undefined,
  };
}

/** 询报价单统计的状态：已发布的轮次 */
export const PUBLISHED_ROUND_STATUSES: RoundStatus[] = [
  'WAITING_QUOTES',
  'QUOTES_CLOSED',
  'OPENED',
  'EVALUATED',
  'SUPERSEDED',
  'CANCELLED',
];
/** 物流报价明细只有开过标的轮次（S-3） */
export const OPENED_ROUND_STATUSES: RoundStatus[] = ['OPENED', 'EVALUATED', 'SUPERSEDED', 'CANCELLED'];

/** 积分分值带正负号：+5、-2 */
export function signedPoints(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
