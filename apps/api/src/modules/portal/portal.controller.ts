import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import {
  portalQuoteListQuerySchema,
  type Paginated,
  type PortalQuoteDetailDto,
  type PortalQuoteListItemDto,
  type PortalQuoteListQuery,
  type SupplierProfileDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, SupplierOnly } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PortalQuotesService } from './portal-quotes.service';

/**
 * 供应商门户（M08 §4）：整个 controller 只允许供应商，一律按当前用户的 supplierId 过滤（05 §7.2）。
 * 附件预览 / 下载走 /api/files/:id/content（InquiryFileResolver 按 P-3 判断并记日志），
 * 改密码、改语言走 /api/auth/me/*
 */
@SupplierOnly()
@Controller('portal')
export class PortalController {
  constructor(private readonly quotes: PortalQuotesService) {}

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

  @Get('profile')
  profile(@CurrentUser() user: AuthUser): Promise<SupplierProfileDto> {
    return this.quotes.profile(user);
  }
}

/** M09 在这里加报价填报，M11 加议价回复 */
@Module({
  controllers: [PortalController],
  providers: [PortalQuotesService],
})
export class PortalModule {}
