import { Controller, Get, Module, Param } from '@nestjs/common';
import {
  roundNoSchema,
  versionNoSchema,
  type QuoteVersionDto,
  type RoundQuoteDetailDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InquiriesModule } from '../inquiries/inquiries.controller';
import { PplModule } from '../ppl/ppl.controller';
import { QuoteAttachmentResolver } from './quote-attachment.resolver';
import { QuoteSheetService } from './quote-sheet.service';
import { RoundQuotesService } from './round-quotes.service';
import { SealService } from './seal.service';

const roundNoPipe = new ZodValidationPipe(roundNoSchema);

/**
 * 采购方查看报价（M10 §4）。M09 先提供报价详情与版本详情两个接口，开标前一律 QUOTE_SEALED；
 * 响应列表在 InquiriesController（M07，只有状态字段）
 */
@Controller('inquiries')
export class RoundQuotesController {
  constructor(private readonly quotes: RoundQuotesService) {}

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
 * 采购方查看报价。门户填报（M09）用 QuoteSheetService，M10 起的比价、开标都要经过 SealService
 */
@Module({
  imports: [InquiriesModule, PplModule],
  controllers: [RoundQuotesController],
  providers: [SealService, QuoteSheetService, QuoteAttachmentResolver, RoundQuotesService],
  exports: [SealService, QuoteSheetService],
})
export class QuotesModule {}
