import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import {
  pageQuerySchema,
  pointsAdjustSchema,
  type PageQuery,
  type PointsAdjustInput,
  type PointsLedgerItemDto,
  type SupplierPointsDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PointsLedgerService } from './points-ledger.service';
import { PointsService } from './points.service';

/** 供应商详情的"积分"页签与手工调整（R15-3、R15-4）；供应商不存在 404 */
@Controller('suppliers')
export class SupplierPointsController {
  constructor(
    private readonly points: PointsService,
    private readonly ledger: PointsLedgerService,
  ) {}

  @RequirePermissions('supplier:view')
  @Get(':id/points')
  list(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<SupplierPointsDto> {
    return this.ledger.supplierPoints(id, query);
  }

  /** 新建一条积分记录（201） */
  @RequirePermissions('points:adjust')
  @Post(':id/points-adjust')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pointsAdjustSchema)) body: PointsAdjustInput,
  ): Promise<PointsLedgerItemDto> {
    return this.points.adjust(user, id, body);
  }
}

/** 积分（01 §4.1 modules/points）：InquiriesModule 引入它做开标结算与定标积分；报表（ReportsModule）用 PointsLedgerService */
@Module({
  controllers: [SupplierPointsController],
  providers: [PointsService, PointsLedgerService],
  exports: [PointsService, PointsLedgerService],
})
export class PointsModule {}
