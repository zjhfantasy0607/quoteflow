import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import {
  negotiationAcceptSchema,
  negotiationCloseSchema,
  negotiationOfferSchema,
  type NegotiationAcceptInput,
  type NegotiationCloseInput,
  type NegotiationOfferInput,
  type NegotiationThreadDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InquiriesModule } from '../inquiries/inquiries.controller';
import { PplModule } from '../ppl/ppl.controller';
import { QuotesModule } from '../quotes/round-quotes.controller';
import { NegotiationAttachmentResolver } from './negotiation-attachment.resolver';
import { NegotiationsService } from './negotiations.service';

/** 采购方议价（M11 §4，需要 inquiry:evaluate，按数据权限）：每个接口返回最新的议价线程 */
@Controller('quotes/:quoteId/negotiation')
export class NegotiationsController {
  constructor(private readonly negotiations: NegotiationsService) {}

  @RequirePermissions('inquiry:evaluate')
  @Get()
  thread(@CurrentUser() user: AuthUser, @Param('quoteId') quoteId: string): Promise<NegotiationThreadDto> {
    return this.negotiations.thread(user, quoteId);
  }

  @RequirePermissions('inquiry:evaluate')
  @Post('offer')
  @HttpCode(200)
  offer(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(negotiationOfferSchema)) body: NegotiationOfferInput,
  ): Promise<NegotiationThreadDto> {
    return this.negotiations.offer(user, quoteId, body);
  }

  @RequirePermissions('inquiry:evaluate')
  @Post('accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(negotiationAcceptSchema)) body: NegotiationAcceptInput,
  ): Promise<NegotiationThreadDto> {
    return this.negotiations.accept(user, quoteId, body);
  }

  @RequirePermissions('inquiry:evaluate')
  @Post('close')
  @HttpCode(200)
  close(
    @CurrentUser() user: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(new ZodValidationPipe(negotiationCloseSchema)) body: NegotiationCloseInput,
  ): Promise<NegotiationThreadDto> {
    return this.negotiations.close(user, quoteId, body);
  }
}

/**
 * 议价（01 §4.1 modules/negotiations）：采购方接口在这里，门户回复（/api/portal/quotes/:quoteId/negotiation）在
 * PortalController，共用 NegotiationsService。系统关闭议价（取消、定标、变更发布）用 close-negotiations.ts
 */
@Module({
  imports: [InquiriesModule, PplModule, QuotesModule],
  controllers: [NegotiationsController],
  providers: [NegotiationsService, NegotiationAttachmentResolver],
  exports: [NegotiationsService],
})
export class NegotiationsModule {}
