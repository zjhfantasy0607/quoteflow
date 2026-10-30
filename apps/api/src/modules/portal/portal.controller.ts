import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  declineQuoteSchema,
  portalQuoteListQuerySchema,
  quoteFormSchema,
  versionNoSchema,
  type DeclineQuoteInput,
  type Paginated,
  type PortalQuoteDetailDto,
  type PortalQuoteListItemDto,
  type PortalQuoteListQuery,
  type QuoteFormInput,
  type QuoteVersionDto,
  type QuoteVersionSummaryDto,
  type SupplierProfileDto,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, SupplierOnly } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IMPORT_HARD_LIMIT_BYTES, xlsxFile } from '../../infra/excel/excel-http';
import type { UploadedFileInput } from '../../infra/files/files.service';
import { PplModule } from '../ppl/ppl.controller';
import { QuotesModule } from '../quotes/round-quotes.controller';
import { PortalQuotesService } from './portal-quotes.service';
import { QuoteSubmissionService } from './quote-submission.service';

/**
 * 供应商门户（M08 §4、M09 §4）：整个 controller 只允许供应商，一律按当前用户的 supplierId 过滤（05 §7.2）。
 * 附件预览 / 下载走 /api/files/:id/content（询价附件 InquiryFileResolver 按 P-3 判断并记日志，
 * 报价附件 QuoteAttachmentResolver 只给本供应商），改密码、改语言走 /api/auth/me/*
 */
@SupplierOnly()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly quotes: PortalQuotesService,
    private readonly submission: QuoteSubmissionService,
  ) {}

  @Get('quotes')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(portalQuoteListQuerySchema)) query: PortalQuoteListQuery,
  ): Promise<Paginated<PortalQuoteListItemDto>> {
    return this.quotes.list(user, query);
  }

  @Get('quotes/:quoteId')
  detail(@CurrentUser() user: AuthUser, @Param('quoteId') quoteId: string): Promise<PortalQuoteDetailDto> {
    return this.quotes.detail(user, quoteId);
  }

  /** R09-3 */
  @Put('quotes/:quoteId/draft')
  saveDraft(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(quoteFormSchema)) body: QuoteFormInput,
  ): Promise<PortalQuoteDetailDto> {
    return this.submission.saveDraft(user, quoteId, body);
  }

  /** R09-4：返回提交后的详情，新版本就是其中的 currentVersion */
  @Post('quotes/:quoteId/submit')
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(quoteFormSchema)) body: QuoteFormInput,
  ): Promise<PortalQuoteDetailDto> {
    return this.submission.submit(user, quoteId, body);
  }

  /** R09-6 */
  @Post('quotes/:quoteId/decline')
  @HttpCode(200)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(declineQuoteSchema)) body: DeclineQuoteInput,
  ): Promise<PortalQuoteDetailDto> {
    return this.submission.decline(user, quoteId, body);
  }

  /** R09-7 */
  @Get('quotes/:quoteId/versions')
  versions(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
  ): Promise<QuoteVersionSummaryDto[]> {
    return this.quotes.versions(user, quoteId);
  }

  @Get('quotes/:quoteId/versions/:versionNo')
  version(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Param('versionNo', new ZodValidationPipe(versionNoSchema)) versionNo: number,
  ): Promise<QuoteVersionDto> {
    return this.quotes.version(user, quoteId, versionNo);
  }

  /** R09-8：锁定 Excel */
  @Get('quotes/:quoteId/excel-template')
  async excelTemplate(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.submission.excelTemplate(user, quoteId);
    return xlsxFile(res, name, buffer);
  }

  /** R09-8：只写草稿，返回导入后的详情；错误 422（EXCEL_*） */
  @Post('quotes/:quoteId/excel-import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_HARD_LIMIT_BYTES, files: 1 } }))
  importExcel(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @UploadedFile() file: UploadedFileInput | undefined,
  ): Promise<PortalQuoteDetailDto> {
    return this.submission.importExcel(user, quoteId, file);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser): Promise<SupplierProfileDto> {
    return this.quotes.profile(user);
  }
}

/** M11 在这里加议价回复 */
@Module({
  imports: [PplModule, QuotesModule],
  controllers: [PortalController],
  providers: [PortalQuotesService, QuoteSubmissionService],
})
export class PortalModule {}
