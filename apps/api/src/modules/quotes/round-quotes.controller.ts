import { Controller, Get, Module, Param } from '@nestjs/common';
import {
  roundNoSchema,
  versionNoSchema,
  type QuoteVersionDto,
  type RoundQuoteDetailDto,
  type RoundResponsesDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InquiriesModule } from '../inquiries/inquiries.controller';
import { PplModule } from '../ppl/ppl.controller';
import { QuoteAttachmentResolver } from './quote-attachment.resolver';
import { QuoteSheetService } from './quote-sheet.service';
import { RoundQuotesService } from './round-quotes.service';
import { RoundResponsesService } from './round-responses.service';
import { SealService } from './seal.service';

const roundNoPipe = new ZodValidationPipe(roundNoSchema);

/**
 * 采购方查看报价（M10 §4）：供应商响应（密封时只有状态字段）、报价详情与版本详情（开标前 QUOTE_SEALED）。
 * 返回报价内容的接口都经过 SealService，并加进密封测试集 sealing.e2e-spec.ts
 */
@Controller('inquiries')
export class RoundQuotesController {
  constructor(
    private readonly responses: RoundResponsesService,
    private readonly quotes: RoundQuotesService,
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
}

/**
 * 报价（01 §4.1 modules/quotes）：密封判断、报价表（冻结的模板、询价行、字典选项）、报价附件的访问解析器、
 * 采购方查看报价（响应列表、报价详情与版本）。门户填报（M09）用 QuoteSheetService，M11 的比价同样要经过 SealService
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
  ],
  exports: [SealService, QuoteSheetService],
})
export class QuotesModule {}
