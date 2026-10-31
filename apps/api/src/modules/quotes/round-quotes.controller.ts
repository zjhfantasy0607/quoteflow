import { Body, Controller, Get, Module, Param, Put, Res, StreamableFile } from '@nestjs/common';
import {
  roundNoSchema,
  shortlistSchema,
  versionNoSchema,
  type QuoteVersionDto,
  type RoundMatrixDto,
  type RoundQuoteDetailDto,
  type RoundResponsesDto,
  type ShortlistInput,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { xlsxFile } from '../../infra/excel/excel-http';
import { InquiriesModule } from '../inquiries/inquiries.controller';
import { PplModule } from '../ppl/ppl.controller';
import { QuoteAttachmentResolver } from './quote-attachment.resolver';
import { QuoteSheetService } from './quote-sheet.service';
import { RoundMatrixExcelService } from './round-matrix-excel.service';
import { RoundMatrixService } from './round-matrix.service';
import { RoundQuotesService } from './round-quotes.service';
import { RoundResponsesService } from './round-responses.service';
import { RoundShortlistService } from './round-shortlist.service';
import { SealService } from './seal.service';

const roundNoPipe = new ZodValidationPipe(roundNoSchema);

/**
 * 采购方查看报价（M10 §4、M11 §4）：供应商响应（密封时只有状态字段）、报价详情与版本详情、比价矩阵与导出
 * （开标前 QUOTE_SEALED）、入围。返回报价内容的接口都经过 SealService，并加进密封测试集 sealing.e2e-spec.ts
 */
@Controller('inquiries')
export class RoundQuotesController {
  constructor(
    private readonly responses: RoundResponsesService,
    private readonly quotes: RoundQuotesService,
    private readonly matrix: RoundMatrixService,
    private readonly matrixExcel: RoundMatrixExcelService,
    private readonly shortlist: RoundShortlistService,
  ) {}

  @RequirePermissions('inquiry:view')
  @Get(':id/rounds/:roundNo/responses')
  responseList(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
  ): Promise<RoundResponsesDto> {
    return this.responses.list(user, id, roundNo);
  }

  @RequirePermissions('inquiry:evaluate')
  @Get(':id/rounds/:roundNo/quotes/:quoteId')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Param('quoteId') quoteId: string,
  ): Promise<RoundQuoteDetailDto> {
    return this.quotes.detail(user, id, roundNo, quoteId);
  }

  @RequirePermissions('inquiry:evaluate')
  @Get(':id/rounds/:roundNo/quotes/:quoteId/versions/:versionNo')
  version(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Param('quoteId') quoteId: string,
    @Param('versionNo', new ZodValidationPipe(versionNoSchema)) versionNo: number,
  ): Promise<QuoteVersionDto> {
    return this.quotes.version(user, id, roundNo, quoteId, versionNo);
  }

  /** R11-1 ~ R11-4 */
  @RequirePermissions('inquiry:evaluate')
  @Get(':id/rounds/:roundNo/matrix')
  matrixOf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
  ): Promise<RoundMatrixDto> {
    return this.matrix.matrix(user, id, roundNo);
  }

  /** R11-5 */
  @RequirePermissions('inquiry:export')
  @Get(':id/rounds/:roundNo/matrix/export')
  async exportMatrix(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.matrixExcel.export(user, id, roundNo);
    return xlsxFile(res, name, buffer);
  }

  /** R11-6：返回调整后的矩阵 */
  @RequirePermissions('inquiry:evaluate')
  @Put(':id/rounds/:roundNo/shortlist')
  saveShortlist(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(shortlistSchema)) body: ShortlistInput,
  ): Promise<RoundMatrixDto> {
    return this.shortlist.save(user, id, roundNo, body.quoteIds);
  }
}

/**
 * 报价（01 §4.1 modules/quotes）：密封判断、报价表（冻结的模板、询价行、字典选项）、报价附件的访问解析器、
 * 采购方查看报价（响应列表、报价详情与版本、比价矩阵与导出、入围）。门户填报（M09）与议价（M11）用 QuoteSheetService
 */
@Module({
  imports: [InquiriesModule, PplModule],
  controllers: [RoundQuotesController],
  providers: [
    SealService,
    QuoteSheetService,
    QuoteAttachmentResolver,
    RoundResponsesService,
    RoundQuotesService,
    RoundMatrixService,
    RoundMatrixExcelService,
    RoundShortlistService,
  ],
  exports: [SealService, QuoteSheetService],
})
export class QuotesModule {}
