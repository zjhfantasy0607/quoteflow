import type {
  InquiryReportParams,
  InquiryReportRowDto,
  LogisticsReportDto,
  LogisticsReportParams,
  PageQuery,
  Paginated,
  PointsAdjustParams,
  PointsLedgerItemDto,
  PointsLedgerParams,
  PointsSummaryParams,
  PointsSummaryRowDto,
  ReportFilterOptionsDto,
  ReportType,
  StatsCycleTimeDto,
  StatsExportParams,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsWinRateDto,
  SupplierPointsDto,
  SupplierQuoteItemDto,
} from '@quoteflow/shared';
import { get, post } from './http';

/** 统计看板（M15 §3）：区间不传时后端取当年 */
export const statsApi = {
  projects: (query: { year?: number; materialCategoryId?: string }) =>
    get<StatsProjectsDto>('/stats/projects', query),
  responseSpeed: (
    query: Pick<StatsExportParams, 'from' | 'to' | 'supplierCategoryCode' | 'materialCategoryId'>,
  ) => get<StatsResponseSpeedDto>('/stats/response-speed', query),
  winRate: (query: Pick<StatsExportParams, 'from' | 'to' | 'supplierId' | 'supplierCategoryCode'>) =>
    get<StatsWinRateDto>('/stats/win-rate', query),
  cycleTime: (query: Pick<StatsExportParams, 'from' | 'to' | 'materialCategoryId'>) =>
    get<StatsCycleTimeDto>('/stats/cycle-time', query),
  /** 导出地址，交给 downloadFile() */
  exportUrl: '/stats/export',
};

/** 数据报表（M15 §4）与积分（R15-3、R15-4） */
export const reportsApi = {
  filterOptions: () => get<ReportFilterOptionsDto>('/reports/filter-options'),
  inquiries: (query: Partial<InquiryReportParams>) =>
    get<Paginated<InquiryReportRowDto>>('/reports/inquiries', query),
  logistics: (query: Partial<LogisticsReportParams>) => get<LogisticsReportDto>('/reports/logistics', query),
  pointsSummary: (query: Partial<PointsSummaryParams>) =>
    get<Paginated<PointsSummaryRowDto>>('/reports/points-summary', query),
  pointsLedger: (query: Partial<PointsLedgerParams>) =>
    get<Paginated<PointsLedgerItemDto>>('/reports/points-ledger', query),
  /** 导出地址（按当前筛选条件，忽略分页），交给 downloadFile() */
  exportUrl: (type: ReportType) => `/reports/${type}/export`,
  supplierQuotes: (supplierId: string, query: Partial<PageQuery>) =>
    get<Paginated<SupplierQuoteItemDto>>(`/suppliers/${supplierId}/quotes`, query),
  supplierPoints: (supplierId: string, query: Partial<PageQuery>) =>
    get<SupplierPointsDto>(`/suppliers/${supplierId}/points`, query),
  /** 备注为空等错误由对话框提示 */
  adjustPoints: (supplierId: string, body: PointsAdjustParams) =>
    post<PointsLedgerItemDto>(`/suppliers/${supplierId}/points-adjust`, body, { silent: true }),
};
