import { REPORT_EXPORT_LIMIT, type PageQuery, type Paginated } from '@quoteflow/shared';

export function skipTake(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toPaginated<T>(items: T[], total: number, query: PageQuery): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** 报表（M15）：分页查询，或导出当前筛选条件下的全部行（最多 REPORT_EXPORT_LIMIT 行，R15-2） */
export type ReportWindow = PageQuery | 'export';

/** 报表查询结果：分页时是当前页；导出时是全部行，truncated 表示超过上限、后面的没导出 */
export interface ReportRows<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export function reportSkipTake(w: ReportWindow): { skip: number; take: number } {
  return w === 'export' ? { skip: 0, take: REPORT_EXPORT_LIMIT } : skipTake(w);
}

/** 已经在内存里排好序的全部行 → 当前页（或导出的前 REPORT_EXPORT_LIMIT 行） */
export function reportSlice<T>(rows: T[], w: ReportWindow): ReportRows<T> {
  const { skip, take } = reportSkipTake(w);
  return {
    items: rows.slice(skip, skip + take),
    total: rows.length,
    truncated: w === 'export' && rows.length > take,
  };
}
