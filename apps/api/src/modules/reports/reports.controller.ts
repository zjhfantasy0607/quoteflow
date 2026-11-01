import { Controller, Get, Module, Param, Query, Res, StreamableFile } from '@nestjs/common';
import {
  inquiryReportQuerySchema,
  logisticsReportQuerySchema,
  pageQuerySchema,
  pointsLedgerQuerySchema,
  pointsSummaryQuerySchema,
  type InquiryReportQuery,
  type InquiryReportRowDto,
  type LogisticsReportDto,
  type LogisticsReportQuery,
  type PageQuery,
  type Paginated,
  type PointsLedgerItemDto,
  type PointsLedgerQuery,
  type PointsSummaryQuery,
  type PointsSummaryRowDto,
  type ReportFilterOptionsDto,
  type SupplierQuoteItemDto,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { toPaginated } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { xlsxFile } from '../../infra/excel/excel-http';
import { MaterialCategoriesModule } from '../material-categories/material-categories.controller';
import { PointsModule } from '../points/points.controller';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PplModule } from '../ppl/ppl.controller';
import { QuotesModule } from '../quotes/round-quotes.controller';
import { QuoteReportsService } from './quote-reports.service';
import { ReportsExcelService } from './reports-excel.service';

const inquiryPipe = new ZodValidationPipe(inquiryReportQuerySchema);
const logisticsPipe = new ZodValidationPipe(logisticsReportQuerySchema);
const summaryPipe = new ZodValidationPipe(pointsSummaryQuerySchema);
const ledgerPipe = new ZodValidationPipe(pointsLedgerQuerySchema);

/**
 * M15 §4、§6：四张报表与导出（GET /api/reports/:type/export，按当前筛选导出全部行，最多 10000 行）。
 * 导出要 report:export，同时要能看报表（report:view）
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly quotes: QuoteReportsService,
    private readonly points: PointsLedgerService,
    private readonly excel: ReportsExcelService,
  ) {}

  /** 统计看板与报表的筛选下拉：有 stats:view 或 report:view 其中之一即可，在 service 里判断 */
  @RequirePermissions()
  @Get('filter-options')
  filterOptions(@CurrentUser() user: AuthUser): Promise<ReportFilterOptionsDto> {
    return this.quotes.filterOptions(user);
  }

  @RequirePermissions('report:view')
  @Get('inquiries')
  async inquiries(
    @CurrentUser() user: AuthUser,
    @Query(inquiryPipe) query: InquiryReportQuery,
  ): Promise<Paginated<InquiryReportRowDto>> {
    const rows = await this.quotes.inquiries(user, query, query);
    return toPaginated(rows.items, rows.total, query);
  }

  @RequirePermissions('report:view')
  @Get('logistics')
  async logistics(
    @CurrentUser() user: AuthUser,
    @Query(logisticsPipe) query: LogisticsReportQuery,
  ): Promise<LogisticsReportDto> {
    const rows = await this.quotes.logistics(user, query, query);
    return { columns: rows.columns, ...toPaginated(rows.items, rows.total, query) };
  }

  @RequirePermissions('report:view')
  @Get('points-summary')
  async pointsSummary(
    @Query(summaryPipe) query: PointsSummaryQuery,
  ): Promise<Paginated<PointsSummaryRowDto>> {
    const rows = await this.points.summary(query, query);
    return toPaginated(rows.items, rows.total, query);
  }

  @RequirePermissions('report:view')
  @Get('points-ledger')
  async pointsLedger(@Query(ledgerPipe) query: PointsLedgerQuery): Promise<Paginated<PointsLedgerItemDto>> {
    const rows = await this.points.ledger(query, query);
    return toPaginated(rows.items, rows.total, query);
  }

  @RequirePermissions('report:view', 'report:export')
  @Get('inquiries/export')
  async exportInquiries(
    @CurrentUser() user: AuthUser,
    @Query(inquiryPipe) query: InquiryReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.excel.inquiries(user, query);
    return xlsxFile(res, name, buffer);
  }

  @RequirePermissions('report:view', 'report:export')
  @Get('logistics/export')
  async exportLogistics(
    @CurrentUser() user: AuthUser,
    @Query(logisticsPipe) query: LogisticsReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.excel.logistics(user, query);
    return xlsxFile(res, name, buffer);
  }

  @RequirePermissions('report:view', 'report:export')
  @Get('points-summary/export')
  async exportPointsSummary(
    @CurrentUser() user: AuthUser,
    @Query(summaryPipe) query: PointsSummaryQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.excel.pointsSummary(user, query);
    return xlsxFile(res, name, buffer);
  }

  @RequirePermissions('report:view', 'report:export')
  @Get('points-ledger/export')
  async exportPointsLedger(
    @CurrentUser() user: AuthUser,
    @Query(ledgerPipe) query: PointsLedgerQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.excel.pointsLedger(user, query);
    return xlsxFile(res, name, buffer);
  }
}

/** R15-4 供应商详情"报价记录"：数据权限内的报价单，金额经过 SealService 与 quote.amount 脱敏；供应商不存在 404 */
@Controller('suppliers')
export class SupplierQuotesController {
  constructor(private readonly quotes: QuoteReportsService) {}

  @RequirePermissions('supplier:view')
  @Get(':id/quotes')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Paginated<SupplierQuoteItemDto>> {
    return this.quotes.supplierQuotes(user, id, query);
  }
}

/** 报表（01 §4.1 modules/reports）：只读；报价相关的经过 QuotesModule 的 SealService，积分的用 PointsModule */
@Module({
  imports: [QuotesModule, PointsModule, PplModule, MaterialCategoriesModule],
  controllers: [ReportsController, SupplierQuotesController],
  providers: [QuoteReportsService, ReportsExcelService],
})
export class ReportsModule {}
