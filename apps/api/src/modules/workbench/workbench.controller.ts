import { Controller, Get, Module } from '@nestjs/common';
import type { PortalWorkbenchDto, WorkbenchDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions, SupplierOnly } from '../../common/auth/decorators';
import { PortalWorkbenchService } from './portal-workbench.service';
import { WorkbenchService } from './workbench.service';

/** M16 采购方工作台：登录即可，卡片按功能权限返回（R16-2 一个接口返回全部卡片） */
@Controller('workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @RequirePermissions()
  @Get()
  overview(@CurrentUser() user: AuthUser): Promise<WorkbenchDto> {
    return this.workbench.overview(user);
  }
}

/** M16 供应商工作台（门户首页）：只允许供应商，按当前用户的 supplierId 过滤（05 §7.2） */
@SupplierOnly()
@Controller('portal/workbench')
export class PortalWorkbenchController {
  constructor(private readonly workbench: PortalWorkbenchService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser): Promise<PortalWorkbenchDto> {
    return this.workbench.overview(user);
  }
}

/** 工作台（01 §4.1 modules/workbench）：只读，汇总"现在该我处理的事" */
@Module({
  controllers: [WorkbenchController, PortalWorkbenchController],
  providers: [WorkbenchService, PortalWorkbenchService],
})
export class WorkbenchModule {}
